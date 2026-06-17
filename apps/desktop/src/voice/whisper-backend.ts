import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIC_SAMPLE_RATE_HZ, pcmToWav } from '@race-engineer/voice';
import type { LocalSttBackend, LocalSttConfig, SttResult, SttStream } from '@race-engineer/voice';
import type { SpawnFn } from './piper-backend';

/**
 * whisper.cpp local-STT native backend (build-plan T10.1, docs/07 §STT, docs/15 free profile). Fills the
 * `whisperCppStt`/`fasterWhisperStt` injected-backend seam (T4.4) so the no-key profile can transcribe
 * push-to-talk speech offline. Batch-shaped like the cloud STT: it buffers the held-PTT frames, then on
 * `finish` writes them to a temp audio file, runs the whisper-cli binary
 * (`-m <model> -f <file> -nt`), and returns the stdout transcript.
 *
 * Native (uses `node:child_process` via the injected {@link SpawnFn} + `node:fs`), so it lives in the
 * desktop app / Node worker, never the renderer. The spawner **and** the file I/O + temp path + clock
 * are all injected, so the whole buffer→file→spawn→parse→cleanup flow is unit-tested offline with
 * fakes — no whisper binary, no real disk. The binary + model come from the model manager (T4.6).
 * Read-only/advisory: it only transcribes the driver's radio-in; no key, no network, no game path.
 *
 * Runtime note: whisper-cli expects 16 kHz mono WAV/PCM. The local STT path therefore needs the mic
 * captured as WAV/PCM (or a whisper build with ffmpeg) — a runtime/rig-verify alignment, flagged in
 * docs/07. The buffer→file→spawn→parse logic here is independent of that and fully tested.
 */

export interface WhisperFsLike {
  writeFile(path: string, data: Uint8Array): Promise<void>;
  rm(path: string): Promise<void>;
}

export interface WhisperBackendOptions {
  spawn?: SpawnFn;
  /** File ops, injected for tests; defaults to `node:fs/promises`. */
  fs?: WhisperFsLike;
  /** Temp directory for the held-PTT audio file; defaults to the OS temp dir. */
  tmpDir?: string;
  /** Monotonic-ish source for a unique temp filename; defaults to `Date.now`. */
  now?: () => number;
  /**
   * whisper-cli beam-search width (`-bs`). Beam search beats greedy decoding on accented speech and
   * jargon at a modest latency cost — fine here because we transcribe once, on PTT release. `0` keeps
   * whisper's greedy default. Defaults to {@link DEFAULT_BEAM_SIZE}.
   */
  beamSize?: number;
  /**
   * Decoder bias prompt (`--prompt`). whisper conditions on this text, so seeding it with the radio's
   * vocabulary ("box this lap", "brake bias", "undercut") sharply cuts mis-hears of racing jargon — the
   * cheapest accuracy win short of a bigger model. Per-call `hints` (from `startStream`) are appended.
   * Pass `''` to disable. Defaults to {@link DEFAULT_STT_PROMPT}.
   */
  prompt?: string;
}

/** whisper beam width — see {@link WhisperBackendOptions.beamSize}. */
export const DEFAULT_BEAM_SIZE = 5;

/**
 * Default decoder-bias prompt for the push-to-talk radio. Not a transcript — it just primes whisper's
 * vocabulary so endurance/strategy terms come through cleanly instead of phonetic guesses. Read-only:
 * this only shapes recognition; it is never spoken and never reaches the game.
 */
export const DEFAULT_STT_PROMPT =
  'Sim racing radio to the race engineer. Box this lap, pit, fuel, stint, tyre pressures, ' +
  'brake bias, traction control, TC, ABS, engine map, undercut, overcut, push, lift and coast, ' +
  'virtual energy, lap time, sector, degradation.';

const defaultFs: WhisperFsLike = {
  writeFile: (path, data) => writeFile(path, data),
  rm: (path) => rm(path, { force: true }),
};

/** Collapse whisper's per-segment stdout into one trimmed transcript line. */
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
};

/**
 * Build the whisper.cpp {@link LocalSttBackend}. Wire it into the shell:
 * `whisperCppStt({ binaryPath, modelPath, language }, whisperCppBackend())`.
 */
export const whisperCppBackend = (opts: WhisperBackendOptions = {}): LocalSttBackend => {
  const spawn = opts.spawn;
  const fsLike = opts.fs ?? defaultFs;
  const dir = opts.tmpDir ?? tmpdir();
  const now = opts.now ?? ((): number => Date.now());
  const beamSize = opts.beamSize ?? DEFAULT_BEAM_SIZE;
  const basePrompt = opts.prompt ?? DEFAULT_STT_PROMPT;
  if (!spawn) {
    // The default spawner is supplied by the worker (node:child_process); tests inject a fake.
    throw new Error('whisperCppBackend: a spawn function is required');
  }

  return (startOpts, config: LocalSttConfig): SttStream => {
    const chunks: Uint8Array[] = [];
    let cancelled = false;

    return {
      pushAudio(frame: Uint8Array): void {
        if (!cancelled) chunks.push(frame);
      },
      onPartial(): void {
        // whisper.cpp here is batch (transcribe on PTT release) — no streaming partials.
      },
      async finish(): Promise<SttResult> {
        if (cancelled || chunks.length === 0) return { transcript: '' };
        if (!config.binaryPath || !config.modelPath) {
          throw new Error('whisper: binaryPath + modelPath not configured (set them from T4.6)');
        }
        const file = join(dir, `re-stt-${now()}.wav`);
        // The renderer streams 16 kHz mono PCM frames; wrap them in a WAV container whisper-cli decodes.
        await fsLike.writeFile(file, pcmToWav(concat(chunks), { sampleRate: MIC_SAMPLE_RATE_HZ }));
        try {
          // Append per-call hints (startStream → SttStartOptions) to the standing vocabulary prompt.
          const prompt = [basePrompt, ...(startOpts.hints ?? [])].join(' ').trim();
          const args = [
            '-m',
            config.modelPath,
            '-f',
            file,
            '-nt', // no timestamps — stdout is plain transcript text
            ...(beamSize > 0 ? ['-bs', String(beamSize)] : []),
            ...(config.language ? ['-l', config.language] : []),
            ...(prompt ? ['--prompt', prompt] : []),
          ];
          const child = spawn(config.binaryPath, args);
          let spawnError: Error | null = null;
          child.once('error', (err) => {
            spawnError = err;
          });
          let text = '';
          const decoder = new TextDecoder();
          if (child.stdout) {
            for await (const data of child.stdout) text += decoder.decode(data, { stream: true });
          }
          text += decoder.decode();
          if (spawnError !== null) throw spawnError;
          return { transcript: collapse(text), confidence01: 1 };
        } finally {
          await fsLike.rm(file).catch(() => {});
        }
      },
      cancel(): void {
        cancelled = true;
        chunks.length = 0;
      },
    };
  };
};
