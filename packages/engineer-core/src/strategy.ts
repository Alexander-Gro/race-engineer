import type { RaceState } from '@race-engineer/core';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import type { StrategySummary } from './ipc';

/**
 * The always-on strategy engine (docs/05 §"always on"): the Core owns the rolling stint history the
 * strategy functions need and recomputes a {@link StrategySummary} each snapshot. It accumulates
 * green-flag fuel deltas + lap times from the canonical RaceState stream and calls the deterministic
 * strategy math — the math lives in `@race-engineer/strategy` (CLAUDE.md rule 1: the LLM never does
 * it). Read-only/advisory: it only reads telemetry and produces recommendations.
 *
 * Hot-path split: {@link observe} accumulates cheaply every tick (so a lap boundary is never missed);
 * {@link summary} runs the model only when a snapshot is emitted (~12 Hz).
 */
const GREEN_LAP_WINDOW = 5;

export class StrategyEngine {
  #lastLapsCompleted: number | null = null;
  #fuelAtLapStart: number | null = null;
  readonly #fuelDeltas: number[] = [];
  readonly #greenLapTimes: number[] = [];

  /** Accumulate from one frame (cheap; called every tick). */
  observe(state: RaceState): void {
    const p = state.player;
    if (this.#fuelAtLapStart === null) this.#fuelAtLapStart = p.fuel.liters;

    if (this.#lastLapsCompleted !== null && p.lapsCompleted > this.#lastLapsCompleted) {
      // A lap just completed — record its green-flag fuel use + lap time (skip in/out/FCY laps).
      const green = state.flags.global === 'green';
      if (green && this.#fuelAtLapStart !== null) {
        const delta = this.#fuelAtLapStart - p.fuel.liters;
        if (delta > 0) this.#fuelDeltas.push(delta); // drops a refuel (negative)
      }
      if (green && p.lastLapS !== null && p.lastLapS > 0) this.#greenLapTimes.push(p.lastLapS);
      this.#fuelAtLapStart = p.fuel.liters;
    }
    this.#lastLapsCompleted = p.lapsCompleted;
  }

  /** Compute the current strategy summary (runs the fuel model; called at snapshot emit). */
  summary(state: RaceState): StrategySummary {
    const p = state.player;
    // Seed from the Normalizer's rolling estimate so a plan is available before our own samples land,
    // then let our accumulated green-lap deltas take over (confidence grows with sample count).
    const prior =
      p.fuel.perLapAvgLiters !== null && p.fuel.perLapAvgLiters > 0
        ? { meanLitersPerLap: p.fuel.perLapAvgLiters, weight: 1 }
        : null;
    const consumption = estimatePerLapConsumption({
      greenLapFuelDeltas: this.#fuelDeltas,
      prior,
      window: GREEN_LAP_WINDOW,
    });

    const avgGreenLapS = this.#avgGreenLapS(p.bestLapS ?? p.lastLapS);
    const race =
      state.session.isTimed && state.session.remainingS !== null && avgGreenLapS !== null
        ? { remainingS: state.session.remainingS, avgGreenLapS }
        : null;

    return { fuelPlan: computeFuelPlan({ fuelLiters: p.fuel.liters, consumption, race }) };
  }

  #avgGreenLapS(fallback: number | null): number | null {
    const recent = this.#greenLapTimes.slice(-GREEN_LAP_WINDOW);
    if (recent.length === 0) return fallback;
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }
}
