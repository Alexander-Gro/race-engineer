/**
 * Rolling fuel-per-lap estimator. The Normalizer feeds it the player's fuel level and lap
 * count each tick; it samples consumption at lap boundaries and reports a rolling average
 * over the last N laps, plus laps-remaining. This is deterministic bookkeeping, not strategy
 * advice — the Strategy Engine (docs/05) consumes these values; it does not live here.
 */

export interface RollingFuelEstimate {
  perLapAvgLiters: number | null; // null until at least one lap has been observed
  lapsRemainingEst: number | null;
}

const mean = (xs: readonly number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length;

export class RollingFuel {
  readonly #windowLaps: number;
  #samples: number[] = [];
  #prevLaps: number | null = null;
  #boundaryFuel: number | null = null;

  constructor(windowLaps = 5) {
    this.#windowLaps = Math.max(1, windowLaps);
  }

  /** Feed the latest reading; returns the current rolling estimate. */
  update(fuelLiters: number, lapsCompleted: number): RollingFuelEstimate {
    if (this.#prevLaps === null || this.#boundaryFuel === null) {
      this.#prevLaps = lapsCompleted;
      this.#boundaryFuel = fuelLiters;
    } else if (lapsCompleted > this.#prevLaps) {
      const lapsElapsed = lapsCompleted - this.#prevLaps;
      const perLap = (this.#boundaryFuel - fuelLiters) / lapsElapsed;
      if (Number.isFinite(perLap) && perLap > 0) {
        this.#samples.push(perLap);
        while (this.#samples.length > this.#windowLaps) this.#samples.shift();
      }
      this.#prevLaps = lapsCompleted;
      this.#boundaryFuel = fuelLiters;
    }

    const perLapAvgLiters = this.#samples.length > 0 ? mean(this.#samples) : null;
    const lapsRemainingEst =
      perLapAvgLiters !== null && perLapAvgLiters > 0 ? fuelLiters / perLapAvgLiters : null;
    return { perLapAvgLiters, lapsRemainingEst };
  }
}
