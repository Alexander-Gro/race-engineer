import type { SttProvider, SttResult, SttStream } from '../types';

/**
 * Cloud STT provider (build-plan T10.1 slice 3b-iii, docs/07 §STT, docs/15 §premium BYO-key). Transcribes
 * push-to-talk audio via an **OpenAI-compatible** `/audio/transcriptions` endpoint — the same key as the
 * cloud TTS, so one OpenAI key turns on the full talk-to-it loop. Implements {@link SttProvider} so
 * `RadioCapture` / the radio loop treat it like the fakes or local engines (provider-swap is config-only
 * — see `profile.ts`). Mirrors the cloud TTS/LLM providers: `fetch` is injectable (mocked-transport
 * tested — no key, no network), the **key comes from OS secure storage and is never embedded** (rule 6),
 * and it calls the vendor directly — no central server.
 *
 * The transcription endpoint is **batch** (multipart file upload), not streaming: the held-PTT audio
 * frames are buffered and transcribed on `finish` — so there are no streaming partials (the engineer
 * answers once the driver releases PTT). Read-only/advisory: it only transcribes the driver's radio in.
 */

/** Multipart-capable fetch (the transcription endpoint takes a file upload). Injectable for tests. */
export type SttFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface CloudSttConfig {
  /** BYO-key from OS secure storage — never embedded, never logged. Empty ⇒ not ready (falls back). */
  apiKey: string;
  /** OpenAI-compatible base, default `https://api.openai.com/v1`. Trailing slashes trimmed. */
  baseUrl?: string;
  /** Transcription model, default `gpt-4o-mini-transcribe`. */
  model?: string;
  /** MIME of the captured audio (renderer `MediaRecorder` is usually webm/opus). Default `audio/webm`. */
  mimeType?: string;
  /** Injectable fetch (tests / non-global runtimes); defaults to `globalThis.fetch`. */
  fetch?: SttFetchLike;
}

const extFromMime = (mime: string): string =>
  mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('mpeg') ? 'mp4' : 'webm';

export class CloudSttProvider implements SttProvider {
  readonly name = 'openai-stt';
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #mimeType: string;
  readonly #fetch: SttFetchLike;

  constructor(config: CloudSttConfig) {
    this.#apiKey = config.apiKey;
    this.#baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.#model = config.model ?? 'gpt-4o-mini-transcribe';
    this.#mimeType = config.mimeType ?? 'audio/webm';
    const f = config.fetch ?? (globalThis as { fetch?: SttFetchLike }).fetch;
    if (!f) throw new Error(`${this.name}: no fetch available on this runtime; pass config.fetch`);
    this.#fetch = f;
  }

  /** Ready only when a key is present, so a profile falls back rather than uploading with no auth. */
  get available(): boolean {
    return this.#apiKey.length > 0;
  }

  startStream(): SttStream {
    const post = this.#fetch;
    const url = `${this.#baseUrl}/audio/transcriptions`;
    const apiKey = this.#apiKey;
    const model = this.#model;
    const mimeType = this.#mimeType;
    const filename = `audio.${extFromMime(mimeType)}`;
    const name = this.name;

    const chunks: Uint8Array[] = [];
    let cancelled = false;

    return {
      pushAudio(frame: Uint8Array): void {
        if (!cancelled) chunks.push(frame);
      },
      onPartial(): void {
        // Batch transcription has no streaming partials — the reply comes on PTT release (finish).
      },
      async finish(): Promise<SttResult> {
        if (cancelled || chunks.length === 0) return { transcript: '' };
        // Concatenate the held-PTT frames into one fresh ArrayBuffer-backed buffer (a clean `BlobPart`).
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const audio = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          audio.set(c, offset);
          offset += c.length;
        }
        const form = new FormData();
        form.append('file', new Blob([audio], { type: mimeType }), filename);
        form.append('model', model);
        form.append('response_format', 'json');
        const res = await post(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` }, // no content-type — fetch sets the boundary
          body: form,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(
            `${name}: transcription failed (${res.status})${detail ? `: ${detail}` : ''}`,
          );
        }
        const json = (await res.json()) as { text?: unknown };
        const transcript = typeof json.text === 'string' ? json.text.trim() : '';
        return { transcript, confidence01: 1 };
      },
      cancel(): void {
        cancelled = true;
        chunks.length = 0;
      },
    };
  }
}

/** OpenAI (or any OpenAI-compatible) cloud STT. `apiKey` from secure storage; absent ⇒ not-ready. */
export const openAiStt = (config: CloudSttConfig): CloudSttProvider => new CloudSttProvider(config);
