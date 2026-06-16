import type { AudioChunk, AudioClip, TtsProvider, VoiceId } from '../types';
import { ProviderNotReadyError } from './errors';

/**
 * Local TTS provider shells (docs/07 §TTS, docs/15 free profile): **Piper** (lightest) and
 * **Kokoro** (quality). They implement {@link TtsProvider} so the rest of the app treats them
 * exactly like the fakes or a cloud provider — provider-swap stays config-only (see `profile.ts`).
 *
 * The native synthesis (a Piper/Kokoro binary + voice model) is **deferred to T10.1**; it is an
 * **injected backend** here. Without one the shell reports `available: false` and throws
 * {@link ProviderNotReadyError} on use (so a profile falls back rather than crashing). With one
 * — wired in T10.1, or a fake in tests — the shell simply delegates. No network, no key, no game.
 */
const concatChunks = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

export type LocalTtsEngine = 'piper' | 'kokoro';

export interface LocalTtsConfig {
  /** Path to the engine binary (Piper executable / Kokoro runtime). Wired in T10.1. */
  binaryPath?: string;
  /** Path to the voice model (e.g. a Piper `.onnx`). */
  modelPath?: string;
  /** Default voice when a call doesn't specify one. */
  voice?: VoiceId;
}

/** The native streaming synthesis, injected in T10.1 (a fake in tests). */
export type LocalTtsBackend = (
  text: string,
  voice: VoiceId,
  config: LocalTtsConfig,
) => AsyncIterable<AudioChunk>;

export class LocalTtsProvider implements TtsProvider {
  readonly name: LocalTtsEngine;
  readonly #config: LocalTtsConfig;
  readonly #backend: LocalTtsBackend | null;

  constructor(
    engine: LocalTtsEngine,
    config: LocalTtsConfig = {},
    backend: LocalTtsBackend | null = null,
  ) {
    this.name = engine;
    this.#config = config;
    this.#backend = backend;
  }

  /** True once the native backend (binary + model) is wired (T10.1). */
  get available(): boolean {
    return this.#backend !== null;
  }

  synthesizeStream(text: string, voice: VoiceId): AsyncIterable<AudioChunk> {
    if (!this.#backend) {
      throw new ProviderNotReadyError(this.name, 'native TTS backend not wired yet (T10.1)');
    }
    return this.#backend(text, voice || this.#config.voice || 'default', this.#config);
  }

  async prerender(phrases: readonly string[], voice: VoiceId): Promise<Map<string, AudioClip>> {
    const clips = new Map<string, AudioClip>();
    for (const phrase of phrases) {
      // Retain the synthesized bytes (like the cloud provider) so the Tier-0 clips are actually
      // audible — the backend already yields a self-describing container (e.g. Piper → WAV). A
      // zero-byte synth leaves `audio` undefined and plays silent.
      const parts: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of this.synthesizeStream(phrase, voice)) {
        parts.push(chunk.data);
        bytes += chunk.data.length;
      }
      const clip: AudioClip = {
        id: `${this.name}:${voice}:${phrase}`,
        label: phrase,
        durationMs: Math.max(40, bytes * 8),
      };
      if (bytes > 0) clip.audio = { data: concatChunks(parts, bytes) };
      clips.set(phrase, clip);
    }
    return clips;
  }
}

/** Piper (lightest local TTS). `backend` is wired in T10.1; omit it for a not-ready shell. */
export const piperTts = (
  config?: LocalTtsConfig,
  backend?: LocalTtsBackend | null,
): LocalTtsProvider => new LocalTtsProvider('piper', config, backend ?? null);

/** Kokoro (quality local TTS, the docs/15 free default). */
export const kokoroTts = (
  config?: LocalTtsConfig,
  backend?: LocalTtsBackend | null,
): LocalTtsProvider => new LocalTtsProvider('kokoro', config, backend ?? null);
