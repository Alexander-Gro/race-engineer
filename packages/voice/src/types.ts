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
  /**
   * Whether the provider is ready to use — its native backend is wired (local) or its key is
   * present (cloud). `undefined` ⇒ always ready (e.g. the fakes). Lets a profile build a
   * graceful fallback chain instead of failing mid-race (docs/15 §free routes).
   */
  readonly available?: boolean;
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

// --- Speech-to-text (driver radio in) ------------------------------------------------

/** A finalized transcription. */
export interface SttResult {
  transcript: string;
  confidence01?: number;
}

/** A streaming STT session: push mic audio, get partials, finalize on release. */
export interface SttStream {
  /** Push a captured audio frame (mic PCM/opus bytes). */
  pushAudio(frame: Uint8Array): void;
  /** Subscribe to streaming partial transcripts (low-latency, non-final). */
  onPartial(cb: (text: string) => void): void;
  /** Stop capture and resolve the final transcript. */
  finish(): Promise<SttResult>;
  /** Abort without producing a result. */
  cancel(): void;
}

/** STT provider (docs/07 §interfaces). Cloud (BYO-key) and local (faster-whisper) impls slot in here. */
export interface SttProvider {
  readonly name: string;
  /** Readiness for a graceful fallback chain (docs/15); `undefined` ⇒ always ready (the fakes). */
  readonly available?: boolean;
  startStream(opts?: { sampleRate?: number; hints?: readonly string[] }): SttStream;
}

/**
 * A microphone audio source. The production impl wraps `getUserMedia`/native capture; tests
 * use a mock. Read-only — it only observes the mic (push-to-talk gates when it's live).
 */
export interface MicSource {
  start(onFrame: (frame: Uint8Array) => void): void;
  stop(): void;
}
