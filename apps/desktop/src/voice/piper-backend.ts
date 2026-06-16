import { readFileSync } from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import { pcmToWav } from '@race-engineer/voice';
import type { AudioChunk, LocalTtsConfig, LocalTtsBackend, VoiceId } from '@race-engineer/voice';

/**
 * Piper local-TTS native backend (build-plan T10.1, docs/07 / docs/15 free profile). Fills the
 * `LocalTtsBackend` seam the `piperTts` shell (T4.4) left open: it spawns the Piper binary
 * (`--model <voice.onnx> --output-raw`), writes the text to stdin, collects the raw PCM Piper emits on
 * stdout, and yields it **wrapped in a WAV container** as a single {@link AudioChunk}. **Free, offline,
 * no key** — the no-key profile can now actually speak.
 *
 * Why WAV-wrap: Piper streams *headerless* 16-bit PCM, but the renderer plays clips through an
 * `<audio>` element, which decodes by container — raw PCM is silent. Prepending a WAV header (the
 * sample rate is read from the voice's `<model>.onnx.json`) makes the bytes a self-describing clip the
 * renderer decodes (browsers sniff WAV by its `RIFF` magic, so no MIME plumbing is needed). Playback is
 * buffered (one clip), and `speak()` synthesizes per sentence, so per-clip buffering costs little — at
 * Piper's ~0.05 real-time factor a sentence renders in a fraction of its spoken length.
 *
 * Native (uses `node:child_process` + `node:fs`) so it lives in the desktop app, not the OS-agnostic
 * `voice` package, and runs only in the Node worker — never the renderer. The spawner **and** the
 * config read are **injected** so the buffer→wrap logic is unit-tested with a fake child process — no
 * Piper binary, no disk; the real binary + voice model are fetched by the model manager (T4.6) and the
 * path passed in `LocalTtsConfig`. Read-only/advisory: it only produces audio bytes (no game path).
 */

/** Minimal structural view of a spawned child — lets tests inject a fake without `ChildProcess`. */
export interface SpawnedChild {
  stdin: { write(chunk: string): void; end(): void } | null;
  stdout: AsyncIterable<Uint8Array> | null;
  once(event: 'error', cb: (err: Error) => void): void;
}

export type SpawnFn = (command: string, args: readonly string[]) => SpawnedChild;

export interface PiperBackendOptions {
  /** Process spawner; defaults to `node:child_process` spawn. Injected as a fake in tests. */
  spawn?: SpawnFn;
  /** Reads a text file (the voice `<model>.onnx.json`), or null if absent/unreadable. Injected in tests. */
  readText?: (path: string) => string | null;
}

/** The real `node:child_process` spawner (shared by the local voice backends). */
export const defaultSpawn: SpawnFn = (command, args) =>
  nodeSpawn(command, [...args]) as unknown as SpawnedChild;

/** Default config reader: best-effort `node:fs`; a missing/unreadable file falls back to the default rate. */
const defaultReadText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/** Piper voices are 16-bit mono; the sample rate varies by voice (commonly 22050). */
const DEFAULT_SAMPLE_RATE = 22050;

/** Read the voice's sample rate from its sibling `<model>.onnx.json` (`audio.sample_rate`), else default. */
const sampleRateFor = (
  modelPath: string | undefined,
  readText: (path: string) => string | null,
): number => {
  if (!modelPath) return DEFAULT_SAMPLE_RATE;
  const raw = readText(`${modelPath}.json`);
  if (!raw) return DEFAULT_SAMPLE_RATE;
  try {
    const cfg = JSON.parse(raw) as { audio?: { sample_rate?: unknown } };
    const sr = cfg.audio?.sample_rate;
    return typeof sr === 'number' && sr > 0 ? sr : DEFAULT_SAMPLE_RATE;
  } catch {
    return DEFAULT_SAMPLE_RATE;
  }
};

const concat = (parts: readonly Uint8Array[], total: number): Uint8Array => {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/**
 * Build the Piper {@link LocalTtsBackend}. Wire it into the shell:
 * `piperTts({ binaryPath, modelPath }, piperTtsBackend())`.
 */
export const piperTtsBackend = (opts: PiperBackendOptions = {}): LocalTtsBackend => {
  const spawn = opts.spawn ?? defaultSpawn;
  const readText = opts.readText ?? defaultReadText;
  return (text: string, _voice: VoiceId, config: LocalTtsConfig): AsyncIterable<AudioChunk> => {
    if (!config.binaryPath) {
      throw new Error('piper: binaryPath not configured (set it from the model manager, T4.6)');
    }
    const binaryPath = config.binaryPath;
    const modelPath = config.modelPath;

    return (async function* stream(): AsyncGenerator<AudioChunk> {
      const args = ['--output-raw', ...(modelPath ? ['--model', modelPath] : [])];
      const child = spawn(binaryPath, args);
      if (!child.stdout || !child.stdin) {
        throw new Error('piper: child process has no stdio');
      }
      let spawnError: Error | null = null;
      child.once('error', (err) => {
        spawnError = err;
      });

      child.stdin.write(text);
      child.stdin.end();

      // Buffer the headerless PCM Piper streams, then emit it WAV-wrapped so the renderer can decode it.
      const parts: Uint8Array[] = [];
      let total = 0;
      for await (const data of child.stdout) {
        if (data.length > 0) {
          parts.push(data);
          total += data.length;
        }
      }
      // A failure to spawn (bad path) surfaces here rather than yielding a silent empty stream.
      if (spawnError !== null) throw spawnError;
      if (total === 0) return; // nothing synthesized → no clip (caller treats as silent)

      const wav = pcmToWav(concat(parts, total), {
        sampleRate: sampleRateFor(modelPath, readText),
      });
      yield { seq: 0, data: wav };
    })();
  };
};
