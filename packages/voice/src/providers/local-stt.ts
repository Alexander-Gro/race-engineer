import type { SttProvider, SttStream } from '../types';
import { ProviderNotReadyError } from './errors';

/**
 * Local STT provider shells (docs/07 §STT, docs/15 free profile): **faster-whisper** (default)
 * and **whisper.cpp** (CPU/portable). They implement {@link SttProvider} so provider-swap stays
 * config-only (see `profile.ts`).
 *
 * The native streaming transcription is **deferred to T10.1** and supplied as an **injected
 * backend**. Without one the shell reports `available: false` and throws
 * {@link ProviderNotReadyError} on `startStream`; with one (T10.1, or a fake in tests) it
 * delegates. No network, no key, no game — fully local and private by design.
 */
export type LocalSttEngine = 'faster-whisper' | 'whisper-cpp';

export interface LocalSttConfig {
  /** Path to the engine binary / library. Wired in T10.1. */
  binaryPath?: string;
  /** Path to the model weights. */
  modelPath?: string;
  /** Model size/name (e.g. `small`, `turbo`). */
  model?: string;
  /** Optional language hint. */
  language?: string;
}

/** Options forwarded from {@link SttProvider.startStream}. */
export interface SttStartOptions {
  sampleRate?: number;
  hints?: readonly string[];
}

/** The native streaming session, injected in T10.1 (a fake in tests). */
export type LocalSttBackend = (opts: SttStartOptions, config: LocalSttConfig) => SttStream;

export class LocalSttProvider implements SttProvider {
  readonly name: LocalSttEngine;
  readonly #config: LocalSttConfig;
  readonly #backend: LocalSttBackend | null;

  constructor(
    engine: LocalSttEngine,
    config: LocalSttConfig = {},
    backend: LocalSttBackend | null = null,
  ) {
    this.name = engine;
    this.#config = config;
    this.#backend = backend;
  }

  /** True once the native backend (binary + model) is wired (T10.1). */
  get available(): boolean {
    return this.#backend !== null;
  }

  startStream(opts: SttStartOptions = {}): SttStream {
    if (!this.#backend) {
      throw new ProviderNotReadyError(this.name, 'native STT backend not wired yet (T10.1)');
    }
    return this.#backend(opts, this.#config);
  }
}

/** faster-whisper (the docs/15 free default STT). `backend` is wired in T10.1. */
export const fasterWhisperStt = (
  config?: LocalSttConfig,
  backend?: LocalSttBackend | null,
): LocalSttProvider => new LocalSttProvider('faster-whisper', config, backend ?? null);

/** whisper.cpp (CPU/portable local STT). */
export const whisperCppStt = (
  config?: LocalSttConfig,
  backend?: LocalSttBackend | null,
): LocalSttProvider => new LocalSttProvider('whisper-cpp', config, backend ?? null);
