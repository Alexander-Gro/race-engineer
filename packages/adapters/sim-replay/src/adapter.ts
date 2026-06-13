import type { GameAdapter, RaceState, Unsubscribe } from '@race-engineer/core';
import { simReplayCapabilities } from './capabilities';
import type { SyntheticConfig } from './synthetic';
import { synthesizeFrames } from './synthetic';

export interface SimReplayAdapterOptions {
  frames: RaceState[];
  id?: string;
}

/**
 * Replays a fixed sequence of canonical frames as a {@link GameAdapter}. Frames are emitted
 * to subscribers in order when `start()` is called; `stop()` halts emission. There is no
 * write path. Tick pacing is the pipeline's job (T0.5) — this adapter just streams.
 */
export class SimReplayAdapter implements GameAdapter<RaceState> {
  readonly id: string;
  readonly #frames: readonly RaceState[];
  readonly #listeners = new Set<(frame: RaceState) => void>();
  #running = false;

  constructor(options: SimReplayAdapterOptions) {
    this.#frames = options.frames;
    this.id = options.id ?? 'sim-replay';
  }

  capabilities() {
    return simReplayCapabilities();
  }

  onFrame(cb: (frame: RaceState) => void): Unsubscribe {
    this.#listeners.add(cb);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  async start(): Promise<void> {
    this.#running = true;
    for (const frame of this.#frames) {
      if (!this.#running) break;
      for (const listener of this.#listeners) {
        listener(frame);
      }
      // Yield between frames so stop() can interrupt; never block the caller's loop.
      await Promise.resolve();
    }
    this.#running = false;
  }

  async stop(): Promise<void> {
    this.#running = false;
  }

  get frameCount(): number {
    return this.#frames.length;
  }
}

/** Build a replay adapter that streams the synthetic generator's output. */
export const syntheticAdapter = (config: SyntheticConfig, id = 'synthetic'): SimReplayAdapter =>
  new SimReplayAdapter({ frames: synthesizeFrames(config), id });

/** Build a replay adapter from an existing frame sequence (e.g. a loaded recording). */
export const replayAdapter = (frames: RaceState[], id = 'sim-replay'): SimReplayAdapter =>
  new SimReplayAdapter({ frames, id });
