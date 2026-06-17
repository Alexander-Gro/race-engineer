import type { VoicePlayer } from './player';
import { parseToneTag, type VoiceDelivery } from './tone';
import type { AudioClip, TtsProvider, VoiceId } from './types';
import { VoicePriority } from './types';

/**
 * Bridge a conversational reply into sentence-streamed TTS on the {@link VoicePlayer}
 * (docs/07 §TTS): split the answer into sentences, synthesize each, and enqueue it so the
 * first sentence plays while the rest are still synthesizing — shrinking perceived latency.
 *
 * The current {@link AudioSink} plays a buffered clip rather than a raw chunk stream, so each
 * sentence is synthesized to one clip; the streaming granularity is per-sentence. A real
 * low-latency streaming sink (the live half) can play chunks as they arrive behind the same
 * call. Read-only / output-only — nothing here touches the game.
 */

/**
 * Split a reply into sentence-sized chunks for sentence-streaming. A `.`/`!`/`?` ends a
 * sentence only when followed by whitespace or end-of-string, so decimals the engineer speaks
 * ("218.7", "fuel 0.8 behind") never split mid-number. Keeps terminal punctuation, never drops
 * characters (any remainder falls through to the trailing `.+`), and returns `[]` for empty
 * input.
 */
export const splitSentences = (text: string): string[] => {
  const matches = text.match(/.+?[.!?]+(?=\s|$)|.+/gs);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [];
};

let clipSeq = 0;

/** Concatenate streamed chunks into one buffer (a buffered clip for the current buffered sink). */
const concatChunks = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/**
 * Drain a {@link TtsProvider} stream into a single playable clip. The clip's `label` is the
 * spoken text (so the transcript log and tests can see exactly what was said); `durationMs` is
 * a rough estimate from the synthesized byte count (display only). The synthesized bytes are
 * **retained** on `clip.audio` so a real sink can play them (a metadata-only clip — zero bytes —
 * leaves `audio` undefined and plays silent).
 */
export const synthesizeClip = async (
  tts: TtsProvider,
  text: string,
  voice: VoiceId,
  delivery?: VoiceDelivery,
): Promise<AudioClip> => {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of tts.synthesizeStream(text, voice, delivery)) {
    chunks.push(chunk.data);
    bytes += chunk.data.length;
  }
  clipSeq += 1;
  const clip: AudioClip = {
    id: `tts-${clipSeq}`,
    label: text,
    durationMs: Math.max(40, bytes * 8),
  };
  if (bytes > 0) clip.audio = { data: concatChunks(chunks, bytes) };
  return clip;
};

export interface SpeakOptions {
  player: VoicePlayer;
  tts: TtsProvider;
  voice: VoiceId;
  text: string;
  /** Queue priority. Default {@link VoicePriority.CHATTER} (conversational reply). */
  priority?: number;
  /**
   * The emotional register to speak in (docs/06 vision). Passed to the TTS provider per sentence so
   * an expressive engine renders the tone the LLM chose; a flat engine ignores it. Default: neutral.
   */
  delivery?: VoiceDelivery;
  /** Abort before enqueuing the next sentence (e.g. the driver keyed PTT again — barge-in). */
  shouldStop?: () => boolean;
  /** Called once, when the first clip is enqueued — the "first audio" instant (latency harness). */
  onFirstClip?: (clip: AudioClip) => void;
}

/**
 * Speak a reply as sentence-streamed TTS and return the clips enqueued (the spoken transcript,
 * for logging/tests). `shouldStop` lets a barge-in halt the remaining sentences mid-reply.
 *
 * **Tone-aware:** the text may carry a leading tone tag (`[urgent] Box this lap.`) — the LLM's
 * chosen emotional register (docs/06 vision). It is stripped here (never spoken aloud) and becomes
 * the {@link VoiceDelivery} for every sentence, so any caller that hands us a model reply gets the
 * emotion for free. An explicit `opts.delivery` wins over the tag; no tag ⇒ neutral default.
 */
export const speak = async (opts: SpeakOptions): Promise<AudioClip[]> => {
  const priority = opts.priority ?? VoicePriority.CHATTER;
  const parsed = parseToneTag(opts.text);
  const delivery = opts.delivery ?? { tone: parsed.tone };
  const spoken: AudioClip[] = [];
  for (const sentence of splitSentences(parsed.text)) {
    if (opts.shouldStop?.()) break;
    const clip = await synthesizeClip(opts.tts, sentence, opts.voice, delivery);
    if (opts.shouldStop?.()) break;
    opts.player.enqueue(clip, priority);
    if (spoken.length === 0) opts.onFirstClip?.(clip);
    spoken.push(clip);
  }
  return spoken;
};
