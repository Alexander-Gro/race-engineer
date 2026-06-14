import type { AudioClip, AudioSink, PlaybackHandle } from './types';
import { VoicePriority } from './types';

/**
 * The voice priority queue (docs/07 §Audio playback). Each utterance has a priority; an
 * urgent item (≥ `urgentThreshold`, default {@link VoicePriority.WARNING}) **preempts** the
 * current one so a long strategy explanation never steps on a "car left". Lower-priority items
 * **queue** and play in priority order (FIFO within a priority). `bargeInStop` (driver presses
 * PTT) stops the engineer immediately and clears pending chatter.
 *
 * Pure scheduling over an injectable {@link AudioSink} — fully unit-testable with a mock sink.
 */

export interface VoicePlayerEvents {
  onStart?: (clip: AudioClip, priority: number) => void;
  onEnded?: (clip: AudioClip) => void;
  onPreempted?: (clip: AudioClip) => void;
  onBargeIn?: (clip: AudioClip | null) => void;
}

export interface VoicePlayerOptions {
  /** Priority at/above which an item preempts the current utterance. Default WARNING (80). */
  urgentThreshold?: number;
  /** Output volume 0..1. Default 1. */
  volume?: number;
  events?: VoicePlayerEvents;
}

export interface EnqueueOptions {
  /** Force preempting the current utterance regardless of priority. */
  preempt?: boolean;
  /** Whether this item may be ducked/dropped (reserved for future ducking). Default true. */
  duckable?: boolean;
}

interface Utterance {
  clip: AudioClip;
  priority: number;
  duckable: boolean;
  seq: number;
}

export class VoicePlayer {
  readonly #sink: AudioSink;
  readonly #urgentThreshold: number;
  readonly #events: VoicePlayerEvents;
  #volume: number;
  #queue: Utterance[] = [];
  #current: { item: Utterance; handle: PlaybackHandle } | null = null;
  #seq = 0;

  constructor(sink: AudioSink, opts: VoicePlayerOptions = {}) {
    this.#sink = sink;
    this.#urgentThreshold = opts.urgentThreshold ?? VoicePriority.WARNING;
    this.#volume = opts.volume ?? 1;
    this.#events = opts.events ?? {};
  }

  enqueue(clip: AudioClip, priority: number, opts: EnqueueOptions = {}): void {
    const item: Utterance = {
      clip,
      priority,
      duckable: opts.duckable ?? true,
      seq: this.#seq++,
    };

    const current = this.#current;
    if (!current) {
      this.#start(item);
      return;
    }

    const urgentPreempt = priority >= this.#urgentThreshold && priority > current.item.priority;
    if (opts.preempt === true || urgentPreempt) {
      current.handle.stop();
      this.#current = null;
      this.#events.onPreempted?.(current.item.clip);
      this.#start(item);
      return;
    }

    this.#insert(item);
  }

  /** Driver keyed PTT: stop the engineer now and clear pending chatter. */
  bargeInStop(): void {
    const clip = this.#current?.item.clip ?? null;
    if (this.#current) {
      this.#current.handle.stop();
      this.#current = null;
    }
    this.#queue = [];
    this.#events.onBargeIn?.(clip);
  }

  setOutputDevice(id: string): void {
    this.#sink.setOutputDevice(id);
  }

  get playing(): { clip: AudioClip; priority: number } | null {
    return this.#current
      ? { clip: this.#current.item.clip, priority: this.#current.item.priority }
      : null;
  }

  get queueLength(): number {
    return this.#queue.length;
  }

  #insert(item: Utterance): void {
    // Highest priority first; FIFO within equal priority (stable by seq).
    let i = this.#queue.findIndex((q) => q.priority < item.priority);
    if (i === -1) i = this.#queue.length;
    this.#queue.splice(i, 0, item);
  }

  #start(item: Utterance): void {
    this.#events.onStart?.(item.clip, item.priority);
    const handle = this.#sink.play(item.clip, {
      volume: this.#volume,
      onEnded: () => this.#onEnded(item),
    });
    this.#current = { item, handle };
  }

  #onEnded(item: Utterance): void {
    if (this.#current?.item.seq !== item.seq) return; // stale (already stopped/preempted)
    this.#events.onEnded?.(item.clip);
    this.#current = null;
    this.#pump();
  }

  #pump(): void {
    if (this.#current || this.#queue.length === 0) return;
    const next = this.#queue.shift();
    if (next) this.#start(next);
  }
}
