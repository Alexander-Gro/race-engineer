/**
 * Time-based throttle for snapshot emission (docs/01: the UI is throttled to ~10–15 Hz so the
 * 60 Hz hot path never floods IPC or the renderer). Emits the first sample, then at most one per
 * `intervalMs` of a **chosen clock**. Sampling on the frame's own `monotonicMs` (not wall-clock)
 * makes it deterministic for replay/synthetic sources and frame-rate-independent for live ones.
 *
 * Pure and timer-free — the caller drives it per frame.
 */
export class Throttle<T> {
  readonly #intervalMs: number;
  readonly #timeOf: (value: T) => number;
  #lastMs: number | null = null;

  constructor(intervalMs: number, timeOf: (value: T) => number) {
    this.#intervalMs = Math.max(0, intervalMs);
    this.#timeOf = timeOf;
  }

  /** True if `value` should be emitted now; advances the gate when it returns true. */
  accept(value: T): boolean {
    const t = this.#timeOf(value);
    if (this.#lastMs === null || t - this.#lastMs >= this.#intervalMs) {
      this.#lastMs = t;
      return true;
    }
    return false;
  }

  /** The clock value of the last accepted sample, or null if nothing has been accepted yet. */
  get lastMs(): number | null {
    return this.#lastMs;
  }
}

/** Convert a snapshot rate (Hz) to a throttle interval (ms), clamping to ≥ 1 Hz. */
export const intervalForHz = (hz: number): number => 1000 / Math.max(1, hz);
