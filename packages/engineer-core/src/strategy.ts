import type { RaceState } from '@race-engineer/core';
import {
  computeFuelPlan,
  estimatePerLapConsumption,
  estimatePerLapEnergy,
  planStints,
} from '@race-engineer/strategy';
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
  /** VE at the current lap's start (0..1), or null when the source doesn't expose Virtual Energy. */
  #energyAtLapStart: number | null = null;
  /** Has the in-progress lap run entirely green so far? Reset each lap; tainted by any non-green tick. */
  #currentLapGreen = true;
  readonly #fuelDeltas: number[] = [];
  /** Per-lap Virtual-Energy burn (0..1), tracked exactly like fuel — VE is often the binding limit. */
  readonly #energyDeltas01: number[] = [];
  readonly #greenLapTimes: number[] = [];

  /** Accumulate from one frame (cheap; called every tick). */
  observe(state: RaceState): void {
    const p = state.player;
    const green = state.flags.global === 'green';
    const energy01 = p.virtualEnergy?.level01 ?? null;
    if (this.#fuelAtLapStart === null) this.#fuelAtLapStart = p.fuel.liters;
    if (this.#energyAtLapStart === null) this.#energyAtLapStart = energy01;

    if (this.#lastLapsCompleted !== null && p.lapsCompleted < this.#lastLapsCompleted) {
      // Lap count went backwards — a session restart or a looped replay. Drop the stale history.
      this.#reset(p.fuel.liters, energy01);
    } else if (this.#lastLapsCompleted !== null && p.lapsCompleted > this.#lastLapsCompleted) {
      // A lap (or more, if frames were dropped) just completed. Record only if it ran green
      // throughout, and average a multi-lap jump so one stall can't skew the estimate ~Nx.
      const lapsElapsed = p.lapsCompleted - this.#lastLapsCompleted;
      if (this.#currentLapGreen && green && this.#fuelAtLapStart !== null) {
        const delta = this.#fuelAtLapStart - p.fuel.liters;
        if (delta > 0) this.#fuelDeltas.push(delta / lapsElapsed); // drops a refuel (negative)
      }
      if (this.#currentLapGreen && green && this.#energyAtLapStart !== null && energy01 !== null) {
        const delta01 = this.#energyAtLapStart - energy01;
        if (delta01 > 0) this.#energyDeltas01.push(delta01 / lapsElapsed); // drops a VE refill
      }
      if (this.#currentLapGreen && green && p.lastLapS !== null && p.lastLapS > 0) {
        this.#greenLapTimes.push(p.lastLapS);
      }
      this.#fuelAtLapStart = p.fuel.liters;
      this.#energyAtLapStart = energy01;
      this.#currentLapGreen = true; // the new lap starts clean
    } else if (!green) {
      this.#currentLapGreen = false; // a non-green tick mid-lap taints the in-progress lap
    }
    this.#lastLapsCompleted = p.lapsCompleted;
  }

  #reset(currentLiters: number, currentEnergy01: number | null): void {
    this.#fuelDeltas.length = 0;
    this.#energyDeltas01.length = 0;
    this.#greenLapTimes.length = 0;
    this.#fuelAtLapStart = currentLiters;
    this.#energyAtLapStart = currentEnergy01;
    this.#currentLapGreen = true;
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

    // Virtual Energy (LMU): track it exactly like fuel and let computeFuelPlan pick the binding
    // constraint. Null when the source doesn't expose VE (then the plan is fuel-only, unchanged).
    const ve = p.virtualEnergy;
    const energy =
      ve !== null
        ? {
            level01: ve.level01,
            consumption: estimatePerLapEnergy({
              greenLapEnergyDeltas01: this.#energyDeltas01,
              prior:
                ve.perLapAvg01 !== null && ve.perLapAvg01 > 0
                  ? { meanPerLap01: ve.perLapAvg01, weight: 1 }
                  : null,
              window: GREEN_LAP_WINDOW,
            }),
          }
        : null;
    const fuelPlan = computeFuelPlan({ fuelLiters: p.fuel.liters, consumption, race, energy });

    // Fuel-bound stint plan for the rest of the race: needs laps-remaining + tank + per-lap. Tyre-life
    // / pit-loss bounds (and the fewer-vs-more-stops trade-off) need per-track calibration (rig backlog).
    const lapsRemaining = this.#lapsRemaining(state, avgGreenLapS);
    const stintPlan =
      lapsRemaining !== null &&
      lapsRemaining >= 1 &&
      p.fuel.capacityLiters !== null &&
      fuelPlan !== null &&
      fuelPlan.perLapLiters > 0
        ? planStints({
            raceLaps: lapsRemaining,
            startLap: p.lapsCompleted,
            tankCapacityLiters: p.fuel.capacityLiters,
            perLapFuelLiters: fuelPlan.perLapLiters,
          })
        : null;

    return { fuelPlan, stintPlan };
  }

  #avgGreenLapS(fallback: number | null): number | null {
    const recent = this.#greenLapTimes.slice(-GREEN_LAP_WINDOW);
    if (recent.length === 0) return fallback;
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  /** Laps left in the race: from the clock + average lap (timed), or the lap count. Null if unknown. */
  #lapsRemaining(state: RaceState, avgLapS: number | null): number | null {
    const s = state.session;
    if (s.isTimed) {
      if (s.remainingS === null || avgLapS === null || !(avgLapS > 0)) return null;
      return Math.ceil(s.remainingS / avgLapS);
    }
    if (s.totalLaps !== null) return Math.max(0, s.totalLaps - state.player.lapsCompleted);
    return null;
  }
}
