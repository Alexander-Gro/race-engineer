import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpawnFn } from './piper-backend';
import { whisperCppBackend, type WhisperFsLike } from './whisper-backend';

const makeSpawn = (opts: { stdout?: string; error?: Error } = {}) => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const spawn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    return {
      stdin: null,
      stdout: (async function* () {
        if (opts.stdout !== undefined) yield new TextEncoder().encode(opts.stdout);
      })(),
      once: (event: 'error', cb: (err: Error) => void) => {
        if (event === 'error' && opts.error) cb(opts.error);
      },
    };
  };
  return { spawn, calls };
};

const makeFs = () => {
  const writes: { path: string; data: Uint8Array }[] = [];
  const removed: string[] = [];
  const fs: WhisperFsLike = {
    writeFile: async (path, data) => {
      writes.push({ path, data });
    },
    rm: async (path) => {
      removed.push(path);
    },
  };
  return { fs, writes, removed };
};

const CONFIG = { binaryPath: '/opt/whisper/whisper-cli', modelPath: '/models/ggml-small.bin' };
const FIXED = { tmpDir: '/tmp', now: () => 123 };
// The backend builds the temp path with node:path `join`, so it is platform-native
// (`/tmp/...` on POSIX, `\tmp\...` on Windows) — derive the expected path the same way.
const WAV = join('/tmp', 're-stt-123.wav');

describe('whisperCppBackend', () => {
  it('buffers PTT frames, transcribes them on finish, and returns the stdout text', async () => {
    const { spawn, calls } = makeSpawn({ stdout: '  Box this lap.\n' });
    const fakeFs = makeFs();
    const stream = whisperCppBackend({ spawn, fs: fakeFs.fs, ...FIXED })({}, CONFIG);
    stream.pushAudio(new Uint8Array([1, 2]));
    stream.pushAudio(new Uint8Array([3]));
    const res = await stream.finish();

    expect(res.transcript).toBe('Box this lap.'); // collapsed/trimmed
    expect(fakeFs.writes[0]?.path).toBe(WAV);
    expect(fakeFs.writes[0]?.data).toEqual(new Uint8Array([1, 2, 3])); // frames concatenated
    expect(calls[0]?.command).toBe('/opt/whisper/whisper-cli');
    expect(calls[0]?.args).toEqual(['-m', '/models/ggml-small.bin', '-f', WAV, '-nt']);
  });

  it('passes the language flag when configured', async () => {
    const { spawn, calls } = makeSpawn({ stdout: 'hola' });
    const stream = whisperCppBackend({ spawn, fs: makeFs().fs, ...FIXED })(
      {},
      { ...CONFIG, language: 'es' },
    );
    stream.pushAudio(new Uint8Array([1]));
    await stream.finish();
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['-l', 'es']));
  });

  it('returns an empty transcript (and does not spawn) when no audio was captured', async () => {
    const { spawn, calls } = makeSpawn({ stdout: 'unused' });
    const fakeFs = makeFs();
    const res = await whisperCppBackend({ spawn, fs: fakeFs.fs, ...FIXED })({}, CONFIG).finish();
    expect(res.transcript).toBe('');
    expect(calls).toHaveLength(0);
    expect(fakeFs.writes).toHaveLength(0);
  });

  it('cancel discards buffered audio → empty transcript, no spawn', async () => {
    const { spawn, calls } = makeSpawn({ stdout: 'x' });
    const stream = whisperCppBackend({ spawn, fs: makeFs().fs, ...FIXED })({}, CONFIG);
    stream.pushAudio(new Uint8Array([1]));
    stream.cancel();
    expect(await stream.finish()).toEqual({ transcript: '' });
    expect(calls).toHaveLength(0);
  });

  it('throws when the binary/model are not configured', async () => {
    const { spawn } = makeSpawn();
    const stream = whisperCppBackend({ spawn, fs: makeFs().fs, ...FIXED })({}, {});
    stream.pushAudio(new Uint8Array([1]));
    await expect(stream.finish()).rejects.toThrow(/binaryPath \+ modelPath/);
  });

  it('cleans up the temp audio file even when the spawn fails', async () => {
    const { spawn } = makeSpawn({ error: new Error('ENOENT: whisper-cli not found') });
    const fakeFs = makeFs();
    const stream = whisperCppBackend({ spawn, fs: fakeFs.fs, ...FIXED })({}, CONFIG);
    stream.pushAudio(new Uint8Array([1]));
    await expect(stream.finish()).rejects.toThrow(/ENOENT/);
    expect(fakeFs.removed).toContain(WAV); // finally-block cleanup
  });

  it('cleans up the temp audio file on success too', async () => {
    const { spawn } = makeSpawn({ stdout: 'ok' });
    const fakeFs = makeFs();
    const stream = whisperCppBackend({ spawn, fs: fakeFs.fs, ...FIXED })({}, CONFIG);
    stream.pushAudio(new Uint8Array([1]));
    await stream.finish();
    expect(fakeFs.removed).toContain(WAV);
  });

  it('requires a spawn function (worker supplies node:child_process; tests inject a fake)', () => {
    expect(() => whisperCppBackend({})).toThrow(/spawn function is required/);
  });
});
