import type { AudioChunk } from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import { piperTtsBackend, type SpawnFn } from './piper-backend';

interface FakeOpts {
  chunks?: Uint8Array[];
  error?: Error;
}

/** A fake spawner that records the call + stdin writes and streams `chunks` from stdout. */
const makeSpawn = (opts: FakeOpts = {}) => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const writes: string[] = [];
  let ended = false;
  const spawn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    return {
      stdin: {
        write: (c: string) => writes.push(c),
        end: () => {
          ended = true;
        },
      },
      stdout: (async function* () {
        for (const c of opts.chunks ?? []) yield c;
      })(),
      once: (event: 'error', cb: (err: Error) => void) => {
        if (event === 'error' && opts.error) cb(opts.error);
      },
    };
  };
  return { spawn, calls, writes, wasEnded: () => ended };
};

const collect = async (it: AsyncIterable<AudioChunk>): Promise<AudioChunk[]> => {
  const out: AudioChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
};

const CONFIG = { binaryPath: '/opt/piper/piper', modelPath: '/models/en_GB-voice.onnx' };

describe('piperTtsBackend', () => {
  it('streams Piper stdout PCM as AudioChunks with incrementing seq', async () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const { spawn } = makeSpawn({ chunks: [a, b] });
    const chunks = await collect(piperTtsBackend({ spawn })('hello', 'default', CONFIG));
    expect(chunks).toEqual([
      { seq: 0, data: a },
      { seq: 1, data: b },
    ]);
  });

  it('writes the text to stdin and closes it', async () => {
    const fake = makeSpawn({ chunks: [new Uint8Array([1])] });
    await collect(piperTtsBackend({ spawn: fake.spawn })('box this lap', 'default', CONFIG));
    expect(fake.writes).toEqual(['box this lap']);
    expect(fake.wasEnded()).toBe(true);
  });

  it('invokes the configured binary with --output-raw and --model', async () => {
    const fake = makeSpawn({ chunks: [new Uint8Array([1])] });
    await collect(piperTtsBackend({ spawn: fake.spawn })('hi', 'default', CONFIG));
    expect(fake.calls[0]?.command).toBe('/opt/piper/piper');
    expect(fake.calls[0]?.args).toEqual(['--output-raw', '--model', '/models/en_GB-voice.onnx']);
  });

  it('omits --model when no model path is configured', async () => {
    const fake = makeSpawn({ chunks: [new Uint8Array([1])] });
    await collect(
      piperTtsBackend({ spawn: fake.spawn })('hi', 'default', { binaryPath: '/p/piper' }),
    );
    expect(fake.calls[0]?.args).toEqual(['--output-raw']);
  });

  it('throws synchronously when no binary path is configured (never a silent stream)', () => {
    const { spawn } = makeSpawn();
    expect(() => piperTtsBackend({ spawn })('hi', 'default', {})).toThrow(/binaryPath/);
  });

  it('surfaces a spawn error rather than yielding a silent empty stream', async () => {
    const { spawn } = makeSpawn({ chunks: [], error: new Error('ENOENT: piper not found') });
    await expect(collect(piperTtsBackend({ spawn })('hi', 'default', CONFIG))).rejects.toThrow(
      /ENOENT/,
    );
  });

  it('skips empty stdout chunks', async () => {
    const { spawn } = makeSpawn({ chunks: [new Uint8Array([]), new Uint8Array([9])] });
    const chunks = await collect(piperTtsBackend({ spawn })('hi', 'default', CONFIG));
    expect(chunks).toEqual([{ seq: 0, data: new Uint8Array([9]) }]);
  });
});
