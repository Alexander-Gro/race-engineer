import type { AudioChunk } from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import { piperTtsBackend, type SpawnFn } from './piper-backend';

interface FakeOpts {
  chunks?: Uint8Array[];
  error?: Error;
}

/** Parse the minimal WAV fields the renderer relies on (RIFF/WAVE magic, sample rate, PCM payload). */
const readWav = (
  wav: Uint8Array,
): { riff: string; wave: string; sampleRate: number; pcm: Uint8Array } => {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (off: number, len: number): string =>
    String.fromCharCode(...wav.subarray(off, off + len));
  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    sampleRate: view.getUint32(24, true),
    pcm: wav.subarray(44),
  };
};

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

// A model config that pins the sample rate, so the WAV-wrap tests don't touch the disk.
const readText22050 = (): string => JSON.stringify({ audio: { sample_rate: 22050 } });

describe('piperTtsBackend', () => {
  it('collects Piper stdout PCM and emits it WAV-wrapped as a single clip', async () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    const { spawn } = makeSpawn({ chunks: [a, b] });
    const chunks = await collect(
      piperTtsBackend({ spawn, readText: readText22050 })('hello', 'default', CONFIG),
    );
    expect(chunks).toHaveLength(1); // one buffered WAV clip, not raw PCM frames
    expect(chunks[0]?.seq).toBe(0);
    const wav = readWav(chunks[0]!.data);
    expect(wav.riff).toBe('RIFF');
    expect(wav.wave).toBe('WAVE');
    expect(wav.sampleRate).toBe(22050);
    expect(Array.from(wav.pcm)).toEqual([1, 2, 3, 4, 5]); // the concatenated PCM payload
  });

  it('reads the sample rate from the voice <model>.onnx.json', async () => {
    const { spawn } = makeSpawn({ chunks: [new Uint8Array([1, 2])] });
    const readText = (path: string): string => {
      expect(path).toBe('/models/en_GB-voice.onnx.json'); // sibling of the model path
      return JSON.stringify({ audio: { sample_rate: 16000 } });
    };
    const [chunk] = await collect(piperTtsBackend({ spawn, readText })('hi', 'default', CONFIG));
    expect(readWav(chunk!.data).sampleRate).toBe(16000);
  });

  it('defaults the sample rate to 22050 when the config is missing/unreadable', async () => {
    const { spawn } = makeSpawn({ chunks: [new Uint8Array([1])] });
    const [chunk] = await collect(
      piperTtsBackend({ spawn, readText: () => null })('hi', 'default', CONFIG),
    );
    expect(readWav(chunk!.data).sampleRate).toBe(22050);
  });

  it('emits nothing when Piper produced no audio (silent, not an empty WAV)', async () => {
    const { spawn } = makeSpawn({ chunks: [new Uint8Array([])] });
    const chunks = await collect(
      piperTtsBackend({ spawn, readText: readText22050 })('hi', 'default', CONFIG),
    );
    expect(chunks).toEqual([]);
  });

  it('writes the text to stdin and closes it', async () => {
    const fake = makeSpawn({ chunks: [new Uint8Array([1])] });
    await collect(
      piperTtsBackend({ spawn: fake.spawn, readText: readText22050 })(
        'box this lap',
        'default',
        CONFIG,
      ),
    );
    expect(fake.writes).toEqual(['box this lap']);
    expect(fake.wasEnded()).toBe(true);
  });

  it('invokes the configured binary with --output-raw and --model', async () => {
    const fake = makeSpawn({ chunks: [new Uint8Array([1])] });
    await collect(
      piperTtsBackend({ spawn: fake.spawn, readText: readText22050 })('hi', 'default', CONFIG),
    );
    expect(fake.calls[0]?.command).toBe('/opt/piper/piper');
    expect(fake.calls[0]?.args).toEqual(['--output-raw', '--model', '/models/en_GB-voice.onnx']);
  });

  it('omits --model when no model path is configured', async () => {
    const fake = makeSpawn({ chunks: [new Uint8Array([1])] });
    await collect(
      piperTtsBackend({ spawn: fake.spawn, readText: () => null })('hi', 'default', {
        binaryPath: '/p/piper',
      }),
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

  it('skips empty stdout chunks (the PCM payload excludes them)', async () => {
    const { spawn } = makeSpawn({ chunks: [new Uint8Array([]), new Uint8Array([9])] });
    const [chunk] = await collect(
      piperTtsBackend({ spawn, readText: readText22050 })('hi', 'default', CONFIG),
    );
    expect(Array.from(readWav(chunk!.data).pcm)).toEqual([9]);
  });
});
