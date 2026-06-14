import type { GameAdapter, RaceState, Unsubscribe } from '@race-engineer/core';
import { simReplayCapabilities } from './capabilities';
import type { SyntheticConfig } from './synthetic';
import { synthesizeFrames } from './synthetic';

export interface SimReplayAdapterOptions {
  frames: RaceState[];
  id?: string;
  /**
   * Wall-clock ms to wait between emitted frames. 0 / undefined = emit as fast as possible (the
   * default — finite replays and tests). A positive value **paces** emission in real time, which is
   * what a synthetic source standing in for a live game needs so the UI shows continuous live values.
   */
  frameIntervalMs?: number;
  /**
   * Loop the sequence forever (a perpetual live demo). Each lap advances every frame's `monotonicMs`
   * by the sequence's span so the app clock keeps climbing (the throttle/UI never see time reverse).
   */
  loop?: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Replays a fixed sequence of canonical frames as a {@link GameAdapter}. Frames are emitted to
 * subscribers in order when `start()` is called; `stop()` halts emission. There is no write path.
 *
 * By default it streams as fast as possible (pacing is the pipeline's job — T0.5). For the desktop
 * app the synthetic source replaces a live game, so `frameIntervalMs` paces emission in real time
 * and `loop` keeps it going — making the dashboard show continuous, evolving values.
 */
export class SimReplayAdapter implements GameAdapter<RaceState> {
  readonly id: string;
  readonly #frames: readonly RaceState[];
  readonly #frameIntervalMs: number;
  readonly #loop: boolean;
  readonly #listeners = new Set<(frame: RaceState) => void>();
  #running = false;

  constructor(options: SimReplayAdapterOptions) {
    this.#frames = options.frames;
    this.id = options.id ?? 'sim-replay';
    this.#frameIntervalMs = Math.max(0, options.frameIntervalMs ?? 0);
    this.#loop = options.loop ?? false;
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
    const frames = this.#frames;
    const n = frames.length;
    // Per-loop monotonicMs bump = the sequence span + one average step, so looping is seamless.
    const span = n > 1 ? frames[n - 1]!.monotonicMs - frames[0]!.monotonicMs : 0;
    const loopIncrement = n > 1 ? span + span / (n - 1) : 0;
    let offset = 0;

    do {
      for (const frame of frames) {
        if (!this.#running) break;
        const emitted =
          offset === 0 ? frame : { ...frame, monotonicMs: frame.monotonicMs + offset };
        for (const listener of this.#listeners) {
          listener(emitted);
        }
        // Pace in real time, or just yield so stop() can interrupt; never block the caller's loop.
        if (this.#frameIntervalMs > 0) await sleep(this.#frameIntervalMs);
        else await Promise.resolve();
      }
      offset += loopIncrement;
    } while (this.#running && this.#loop);
    this.#running = false;
  }

  async stop(): Promise<void> {
    this.#running = false;
  }

  get frameCount(): number {
    return this.#frames.length;
  }
}

export interface SyntheticAdapterOptions {
  id?: string;
  /** Real-time pacing between frames (ms); see {@link SimReplayAdapterOptions.frameIntervalMs}. */
  frameIntervalMs?: number;
  /** Loop forever for a perpetual live demo; see {@link SimReplayAdapterOptions.loop}. */
  loop?: boolean;
}

/** Build a replay adapter that streams the synthetic generator's output. */
export const syntheticAdapter = (
  config: SyntheticConfig,
  options: SyntheticAdapterOptions = {},
): SimReplayAdapter =>
  new SimReplayAdapter({
    frames: synthesizeFrames(config),
    id: options.id ?? 'synthetic',
    frameIntervalMs: options.frameIntervalMs,
    loop: options.loop,
  });

/** Build a replay adapter from an existing frame sequence (e.g. a loaded recording). */
export const replayAdapter = (frames: RaceState[], id = 'sim-replay'): SimReplayAdapter =>
  new SimReplayAdapter({ frames, id });
