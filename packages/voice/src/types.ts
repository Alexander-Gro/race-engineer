/**
 * Voice output contracts (docs/07). Providers are swappable and testable with fakes; the
 * priority queue + Tier-0 pre-render are pure logic over an injectable {@link AudioSink}, so
 * all of it runs in unit tests with no audio device, no key, and no network.
 *
 * Tiered output (docs/01, docs/07): reflex spotter calls are pre-rendered clips played at the
 * highest priority; conversational replies stream from TTS at low priority. Higher priority
 * preempts lower so a long strategy explanation never steps on a "car left".
 */

export type VoiceId = string;

/** A streamed unit of synthesized audio (sentence-streaming TTS). Opaque bytes. */
export interface AudioChunk {
  seq: number;
  data: Uint8Array;
}

/** A playable, possibly pre-rendered, audio item. */
export interface AudioClip {
  id: string;
  /** Human-readable label (the phrase / transcript snippet) — handy for tests/logs. */
  label?: string;
  durationMs?: number;
}

/** A handle to in-progress playback. */
export interface PlaybackHandle {
  stop(): void;
  setVolume(v: number): void;
}

/**
 * Where audio actually goes. The production sink wraps an OS/Electron output device; tests use
 * a mock. `onEnded` fires on natural completion only — `stop()` (preempt/barge-in) does not.
 */
export interface AudioSink {
  play(clip: AudioClip, opts: { volume: number; onEnded: () => void }): PlaybackHandle;
  setOutputDevice(id: string): void;
}

/** TTS provider (docs/07 §interfaces). Cloud (BYO-key) and local (Piper/Kokoro) impls slot in here. */
export interface TtsProvider {
  readonly name: string;
  /** Stream synthesized audio so playback can start before the whole reply is generated. */
  synthesizeStream(text: string, voice: VoiceId): AsyncIterable<AudioChunk>;
  /** Pre-render fixed phrases once (Tier-0); returns a phrase→clip map. */
  prerender(phrases: readonly string[], voice: VoiceId): Promise<Map<string, AudioClip>>;
}

/**
 * Suggested priorities for {@link VoicePlayer.enqueue} (higher preempts lower). Items at or
 * above the player's urgent threshold (default {@link VoicePriority.WARNING}) preempt the
 * current utterance; below it, they queue and play in priority order.
 */
export const VoicePriority = {
  /** Tier-0 reflex safety call-outs ("car left", "three wide"). */
  SPOTTER: 100,
  /** Urgent strategy ("box this lap", blue flag). */
  WARNING: 80,
  /** Normal strategy call-outs. */
  STRATEGY: 50,
  /** Conversational replies / low-priority chatter. */
  CHATTER: 20,
} as const;
