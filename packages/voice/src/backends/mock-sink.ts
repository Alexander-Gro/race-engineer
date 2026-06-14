import type { AudioClip, AudioSink, PlaybackHandle } from '../types';

/**
 * In-memory {@link AudioSink} for tests. Records the order clips start/stop and lets a test
 * complete the current clip naturally via {@link MockAudioSink.finishCurrent}, so the priority
 * queue's scheduling (preempt / barge-in / FIFO-by-priority) is fully deterministic.
 */
export class MockAudioSink implements AudioSink {
  readonly started: string[] = [];
  readonly stopped: string[] = [];
  outputDevice: string | null = null;
  #current: { clip: AudioClip; onEnded: () => void } | null = null;

  play(clip: AudioClip, opts: { volume: number; onEnded: () => void }): PlaybackHandle {
    this.started.push(clip.id);
    const entry = { clip, onEnded: opts.onEnded };
    this.#current = entry;
    return {
      stop: () => {
        if (this.#current === entry) this.#current = null;
        this.stopped.push(clip.id);
      },
      setVolume: () => {},
    };
  }

  setOutputDevice(id: string): void {
    this.outputDevice = id;
  }

  /** The clip currently playing (null if idle). */
  get playing(): AudioClip | null {
    return this.#current?.clip ?? null;
  }

  /** Test helper: finish the current clip naturally (fires its onEnded). */
  finishCurrent(): void {
    const entry = this.#current;
    if (!entry) return;
    this.#current = null;
    entry.onEnded();
  }
}
