import type { VoicePlayer } from './player';
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

/**
 * Drain a {@link TtsProvider} stream into a single playable clip. The clip's `label` is the
 * spoken text (so the transcript log and tests can see exactly what was said); `durationMs` is
 * a rough estimate from the synthesized byte count (display only).
 */
export const synthesizeClip = async (
  tts: TtsProvider,
  text: string,
  voice: VoiceId,
): Promise<AudioClip> => {
  let bytes = 0;
  for await (const chunk of tts.synthesizeStream(text, voice)) bytes += chunk.data.length;
  clipSeq += 1;
  return { id: `tts-${clipSeq}`, label: text, durationMs: Math.max(40, bytes * 8) };
};

export interface SpeakOptions {
  player: VoicePlayer;
  tts: TtsProvider;
  voice: VoiceId;
  text: string;
  /** Queue priority. Default {@link VoicePriority.CHATTER} (conversational reply). */
  priority?: number;
  /** Abort before enqueuing the next sentence (e.g. the driver keyed PTT again — barge-in). */
  shouldStop?: () => boolean;
  /** Called once, when the first clip is enqueued — the "first audio" instant (latency harness). */
  onFirstClip?: (clip: AudioClip) => void;
}

/**
 * Speak a reply as sentence-streamed TTS and return the clips enqueued (the spoken transcript,
 * for logging/tests). `shouldStop` lets a barge-in halt the remaining sentences mid-reply.
 */
export const speak = async (opts: SpeakOptions): Promise<AudioClip[]> => {
  const priority = opts.priority ?? VoicePriority.CHATTER;
  const spoken: AudioClip[] = [];
  for (const sentence of splitSentences(opts.text)) {
    if (opts.shouldStop?.()) break;
    const clip = await synthesizeClip(opts.tts, sentence, opts.voice);
    if (opts.shouldStop?.()) break;
    opts.player.enqueue(clip, priority);
    if (spoken.length === 0) opts.onFirstClip?.(clip);
    spoken.push(clip);
  }
  return spoken;
};
