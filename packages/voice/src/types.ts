/**
 * Voice output contracts (docs/07). Providers are swappable and testable with fakes; the
 * priority queue is pure logic over an injectable {@link AudioSink}, so all of it runs in unit
 * tests with no audio device, no key, and no network.
 *
 * Tiered output (docs/01, docs/07): every engineer line is synthesized and queued. Nothing cuts off
 * a line in progress — call-outs and replies queue and play in priority order (a higher-priority
 * call jumps ahead of lower-priority ones, but waits for the current clip to finish). The only
 * interrupt is the driver keying push-to-talk (`bargeInStop`).
 */

import type { VoiceDelivery } from './tone';

export type VoiceId = string;

/** A streamed unit of synthesized audio (sentence-streaming TTS). Opaque bytes. */
export interface AudioChunk {
  seq: number;
  data: Uint8Array;
}

/** Raw synthesized audio for playback. Opaque to the queue; the sink/renderer decodes + plays it. */
export interface AudioData {
  /** The synthesized audio bytes (a full clip; structured-clone-safe across the worker↔renderer IPC). */
  data: Uint8Array;
  /** Container/codec hint for the decoder (e.g. `audio/wav`, `audio/mpeg`); a decoder may sniff if absent. */
  mimeType?: string;
}

/** A playable, possibly pre-rendered, audio item. */
export interface AudioClip {
  id: string;
  /** Human-readable label (the phrase / transcript snippet) — handy for tests/logs. */
  label?: string;
  durationMs?: number;
  /**
   * The synthesized audio bytes, once a TTS provider produces them (sentence-streamed replies via
   * `synthesizeClip`; pre-rendered Tier-0 clips once the real provider retains them). Absent ⇒
   * metadata-only (the fakes, or a not-yet-synthesized phrase) → the sink plays silence for
   * `durationMs`, so the queue still drains.
   */
  audio?: AudioData;
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
  /**
   * Stream synthesized audio so playback can start before the whole reply is generated. The optional
   * {@link VoiceDelivery} carries the emotional register (docs/06 vision): a provider that can express
   * tone (Piper via its noise/length knobs, the cloud voice via a tone instruction) renders it; one
   * that can't simply ignores it and speaks neutrally. Delivery only — it never changes the words.
   */
  synthesizeStream(
    text: string,
    voice: VoiceId,
    delivery?: VoiceDelivery,
  ): AsyncIterable<AudioChunk>;
  /** Pre-render fixed phrases once (Tier-0); returns a phrase→clip map. */
  prerender(phrases: readonly string[], voice: VoiceId): Promise<Map<string, AudioClip>>;
}

/**
 * Suggested priorities for {@link VoicePlayer.enqueue} (higher plays first). Nothing **preempts**
 * (cuts off) the current utterance by priority alone — items **queue** and play in priority order, a
 * higher-priority one jumping ahead of lower-priority ones but waiting for the current clip to
 * finish. The only interrupt is the driver keying PTT ({@link VoicePlayer.bargeInStop}) — or an
 * explicit `preempt` flag on `enqueue`.
 */
export const VoicePriority = {
  /**
   * A live reply to the driver's own question. The top tier: an answer is delivered ahead of any
   * queued call-out (the driver asked; finish answering before volunteering something else).
   */
  CONVERSATION: 90,
  /** Urgent strategy ("box this lap", blue flag) — jumps the queue, ahead of routine call-outs. */
  WARNING: 80,
  /** Normal strategy call-outs. */
  STRATEGY: 50,
  /** Low-priority chatter (e.g. unsolicited Tier-2 colour). */
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
