import { DEFAULT_TONE, type VocalTone, type VoiceDelivery } from '../tone';
import type { AudioChunk, AudioClip, TtsProvider, VoiceId } from '../types';

/**
 * Tone → a natural-language delivery instruction for an instruction-aware cloud voice (OpenAI
 * `gpt-4o-mini-tts` takes an `instructions` field that steers *how* it speaks). This is where the
 * LLM's chosen register becomes audible emotion. `calm` sends none — the voice's neutral default.
 */
const TONE_INSTRUCTION: Record<VocalTone, string | null> = {
  calm: null,
  urgent:
    'Speak with urgency and tension — fast, clipped, and firm, like a race engineer calling the driver in right now.',
  upbeat: 'Speak with warmth and energy — encouraging and pleased, like praising a strong lap.',
  serious: 'Speak in a low, deliberate, serious tone — measured and grave, no lightness.',
};

/**
 * Cloud TTS provider (build-plan T10.1 slice 3b, docs/07 §TTS, docs/15 §premium BYO-key). Speaks via
 * an **OpenAI-compatible** `/audio/speech` endpoint — one key covers TTS (and, later, STT), the fastest
 * audible voice path on the dev Mac. Implements {@link TtsProvider} so the queue / pre-render / radio
 * loop treat it exactly like the fakes or the local engines (provider-swap is config-only — see
 * `profile.ts`). Mirrors the cloud **LLM** providers (T5.1b): `fetch` is injectable (so it's
 * mocked-transport tested with no key, no network), the **key comes from OS secure storage and is never
 * embedded** (CLAUDE.md rule 6), and it calls the vendor directly — no central server.
 *
 * Read-only/advisory: it only synthesizes the engineer's own speech. No game path.
 */

/** Binary-capable fetch (the speech endpoint returns audio bytes, not JSON). Injectable for tests. */
export type TtsFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}>;

/** Audio container the endpoint returns; maps to the MIME type the renderer plays the clip as. */
export type CloudTtsFormat = 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm';

const MIME_BY_FORMAT: Record<CloudTtsFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pcm: 'audio/pcm',
};

export interface CloudTtsConfig {
  /** BYO-key from OS secure storage — never embedded, never logged. Empty ⇒ not ready (falls back). */
  apiKey: string;
  /** OpenAI-compatible base, default `https://api.openai.com/v1`. Trailing slashes trimmed. */
  baseUrl?: string;
  /** TTS model, default `gpt-4o-mini-tts`. */
  model?: string;
  /** The **vendor** voice (e.g. `alloy`/`onyx`), default `alloy` — distinct from the app's `VoiceId`. */
  voice?: string;
  /** Audio container, default `mp3` (widely playable via the renderer's Web Audio element). */
  format?: CloudTtsFormat;
  /** Injectable fetch (tests / non-global runtimes); defaults to `globalThis.fetch`. */
  fetch?: TtsFetchLike;
}

const concatChunks = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

export class CloudTtsProvider implements TtsProvider {
  readonly name = 'openai-tts';
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #voice: string;
  readonly #format: CloudTtsFormat;
  readonly #mimeType: string;
  readonly #fetch: TtsFetchLike;

  constructor(config: CloudTtsConfig) {
    this.#apiKey = config.apiKey;
    this.#baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.#model = config.model ?? 'gpt-4o-mini-tts';
    this.#voice = config.voice ?? 'alloy';
    this.#format = config.format ?? 'mp3';
    this.#mimeType = MIME_BY_FORMAT[this.#format];
    const f = config.fetch ?? (globalThis as { fetch?: TtsFetchLike }).fetch;
    if (!f) throw new Error(`${this.name}: no fetch available on this runtime; pass config.fetch`);
    this.#fetch = f;
  }

  /** Ready only when a key is present, so a profile falls back rather than calling with no auth. */
  get available(): boolean {
    return this.#apiKey.length > 0;
  }

  /**
   * Synthesize `text` to audio bytes. The vendor `voice` comes from config (the app's {@link VoiceId}
   * is an app-level handle, not an OpenAI voice). The endpoint returns the whole clip, yielded as one
   * chunk — `speak()` synthesizes per sentence, so the first sentence still plays while the next renders.
   */
  async *synthesizeStream(
    text: string,
    _voice: VoiceId,
    delivery?: VoiceDelivery,
  ): AsyncIterable<AudioChunk> {
    const instructions = TONE_INSTRUCTION[delivery?.tone ?? DEFAULT_TONE];
    const res = await this.#fetch(`${this.#baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#apiKey}` },
      body: JSON.stringify({
        model: this.#model,
        input: text,
        voice: this.#voice,
        response_format: this.#format,
        // Steer *delivery* only (the LLM's chosen tone) — never the words. Omitted for the neutral
        // default and for models that don't accept it (the field is simply ignored server-side).
        ...(instructions ? { instructions } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `${this.name}: speech request failed (${res.status})${detail ? `: ${detail}` : ''}`,
      );
    }
    const buf = await res.arrayBuffer();
    yield { seq: 0, data: new Uint8Array(buf) };
  }

  /** Pre-render fixed phrases (Tier-0), **retaining the bytes + MIME** so the clips are audible. */
  async prerender(phrases: readonly string[], voice: VoiceId): Promise<Map<string, AudioClip>> {
    const clips = new Map<string, AudioClip>();
    for (const phrase of phrases) {
      const parts: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of this.synthesizeStream(phrase, voice)) {
        parts.push(chunk.data);
        bytes += chunk.data.length;
      }
      const clip: AudioClip = {
        id: `${this.name}:${phrase}`,
        label: phrase,
        durationMs: Math.max(40, bytes * 8),
      };
      if (bytes > 0) clip.audio = { data: concatChunks(parts, bytes), mimeType: this.#mimeType };
      clips.set(phrase, clip);
    }
    return clips;
  }
}

/** OpenAI (or any OpenAI-compatible) cloud TTS. `apiKey` from secure storage; absent ⇒ not-ready. */
export const openAiTts = (config: CloudTtsConfig): CloudTtsProvider => new CloudTtsProvider(config);
