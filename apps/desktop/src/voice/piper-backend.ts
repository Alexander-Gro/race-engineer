import { spawn as nodeSpawn } from 'node:child_process';
import type { AudioChunk, LocalTtsBackend, LocalTtsConfig, VoiceId } from '@race-engineer/voice';

/**
 * Piper local-TTS native backend (build-plan T10.1, docs/07 / docs/15 free profile). Fills the
 * `LocalTtsBackend` seam the `piperTts` shell (T4.4) left open: it spawns the Piper binary
 * (`--model <voice.onnx> --output-raw`), writes the text to stdin, and streams the raw PCM Piper
 * emits on stdout back as {@link AudioChunk}s. **Free, offline, no key** — the no-key profile can now
 * actually speak.
 *
 * Native (uses `node:child_process`) so it lives in the desktop app, not the OS-agnostic `voice`
 * package, and runs only in the Node worker — never the renderer. The spawner is **injected**
 * (`SpawnFn`) so the streaming/lifecycle logic is unit-tested with a fake child process — no Piper
 * binary needed offline; the real binary + voice model are fetched by the model manager (T4.6) and the
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
}

const defaultSpawn: SpawnFn = (command, args) =>
  nodeSpawn(command, [...args]) as unknown as SpawnedChild;

/**
 * Build the Piper {@link LocalTtsBackend}. Wire it into the shell:
 * `piperTts({ binaryPath, modelPath }, piperTtsBackend())`.
 */
export const piperTtsBackend = (opts: PiperBackendOptions = {}): LocalTtsBackend => {
  const spawn = opts.spawn ?? defaultSpawn;
  return (_text: string, _voice: VoiceId, config: LocalTtsConfig): AsyncIterable<AudioChunk> => {
    const text = _text;
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

      let seq = 0;
      for await (const data of child.stdout) {
        if (data.length > 0) yield { seq: seq++, data };
      }
      // A failure to spawn (bad path) surfaces here rather than yielding a silent empty stream.
      if (spawnError !== null) throw spawnError;
    })();
  };
};
