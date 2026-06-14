import type { StintPlan } from '@race-engineer/core';
import { degLossOverStintS, type TireDegradation } from './tires';

/**
 * Stint planner (docs/05 §4). Pure, deterministic — the LLM calls this as a tool (`get_stint_plan`)
 * and phrases the result; it never reproduces the math (CLAUDE.md rule 1). Read-only/advisory: it
 * recommends stint boundaries, fuel loads, and pit windows — the driver makes every change.
 *
 * Given the laps to cover, tank capacity, fuel-per-lap, tyre life, and mandatory stops, it:
 *   1. bounds the max stint length by fuel (`floor((tank − reserve) / perLap)`) and by tyre life,
 *   2. takes the fewest stints that cover the race within those caps and satisfy mandatory stops,
 *   3. **only when both a pit-loss and a confident tyre-deg rate are known**, checks whether one or
 *      more *extra* stops would save more in degradation than they cost in pit-loss (docs/05 §4
 *      "prefer fewer stops unless tyre-deg cost > pit-loss savings") — otherwise it prefers fewer
 *      stops, honestly, rather than guessing,
 *   4. distributes the laps as evenly as possible across the chosen stints (even stints minimise the
 *      convex cumulative-deg cost) and emits a {@link StintPlan}.
 *
 * It composes the other strategy models: `perLapFuelLiters` from the fuel model (T3.1), `deg` from
 * the tyre model (T7.1, via `degLossOverStintS`), and `pitLossS` from the pit-loss model (T7.2).
 */

const DEFAULT_MAX_EXTRA_STOPS = 3;
/** Below this tyre-deg confidence the fewer-vs-more-stops trade-off is too shaky to act on. */
const DEG_CONFIDENCE_FLOOR = 0.2;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export interface StintPlannerInput {
  /** Laps to plan over (whole race, or laps remaining for a mid-race re-plan). */
  raceLaps: number;
  /** Lap the first planned stint starts from (0 = race start). Default 0. */
  startLap?: number;
  /** Usable fuel-tank capacity (L) — bounds max stint length by fuel. */
  tankCapacityLiters: number;
  /** Per-lap fuel consumption (L/lap), from the fuel model. Must be > 0 or the plan is silent. */
  perLapFuelLiters: number;
  /** Fuel to keep in the tank at the flag / on arrival at each stop (L). Default ~1 lap. */
  reserveLiters?: number;
  /** Max stint length the tyres allow (laps), from the tyre model / a wear limit. Null = unbounded. */
  maxStintLapsByTire?: number | null;
  /** Mandatory pit stops required by the rules (driver changes etc.). Default 0. */
  mandatoryStops?: number;
  /** Compound label to record per stint (advisory only). Default null. */
  tireCompound?: string | null;
  /** Total pit-loss per stop (s), from the pit-loss model. Enables the fewer-vs-more-stops trade-off. */
  pitLossS?: number | null;
  /** Tyre degradation (T7.1) for the trade-off; only acted on above {@link DEG_CONFIDENCE_FLOOR}. */
  deg?: TireDegradation | null;
  /** How many stops beyond the fuel/tyre minimum to consider when trading off. Default 3. */
  maxExtraStops?: number;
}

/** Max laps a stint can run before fuel hits the reserve: `floor((tank − reserve) / perLap)`. */
export const maxStintLapsByFuel = (
  tankCapacityLiters: number,
  perLapFuelLiters: number,
  reserveLiters: number,
): number => {
  if (!(perLapFuelLiters > 0)) return 0;
  const usable = Math.max(0, tankCapacityLiters - Math.max(0, reserveLiters));
  return Math.floor(usable / perLapFuelLiters);
};

/**
 * Split `totalLaps` across `numStints` as evenly as possible; the remainder laps go to the earliest
 * (longest) stints. Even stints minimise the convex Σ degRate·N(N+1)/2 deg cost.
 */
export const distributeLaps = (totalLaps: number, numStints: number): number[] => {
  const n = Math.max(1, Math.floor(numStints));
  const total = Math.max(0, Math.floor(totalLaps));
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
};

export interface StintCountChoice {
  numStints: number;
  /** Laps per stint (balanced; sums to raceLaps). */
  sizes: number[];
  /** Cumulative degradation time cost across all stints (s); 0 when deg is unknown. */
  degCostS: number;
  /** Pit time cost: `(numStints − 1) · pitLoss` (s); 0 when pit-loss is unknown. */
  pitCostS: number;
  /** Comparable race time = degCost + pitCost (s). Green base lap time is constant across plans. */
  totalComparableS: number;
}

const degCostForSizes = (
  sizes: readonly number[],
  deg: TireDegradation | null | undefined,
): number => (deg ? sizes.reduce((acc, laps) => acc + degLossOverStintS(deg, laps), 0) : 0);

/**
 * Choose the number of stints. Returns the fewest feasible stints unless a quantified deg/pit-loss
 * trade-off shows extra stops are net faster. Null when nothing is plannable (no fuel rate, no laps,
 * or the tank can't even cover one lap + reserve).
 */
export const optimizeStintCount = (input: StintPlannerInput): StintCountChoice | null => {
  const raceLaps = Math.floor(input.raceLaps);
  if (!(input.perLapFuelLiters > 0) || raceLaps < 1) return null;

  const reserve = input.reserveLiters ?? input.perLapFuelLiters;
  const fuelCap = maxStintLapsByFuel(input.tankCapacityLiters, input.perLapFuelLiters, reserve);
  const tireCap =
    input.maxStintLapsByTire != null && input.maxStintLapsByTire > 0
      ? Math.floor(input.maxStintLapsByTire)
      : Infinity;
  const maxStint = Math.min(fuelCap, tireCap);
  if (!(maxStint >= 1)) return null; // can't complete a single lap within the fuel/tyre limit

  const mandatoryStops = Math.max(0, Math.floor(input.mandatoryStops ?? 0));
  const minStints = Math.max(Math.ceil(raceLaps / maxStint), mandatoryStops + 1);

  const pitLossS = input.pitLossS != null && input.pitLossS > 0 ? input.pitLossS : null;
  const canTradeoff =
    pitLossS !== null &&
    !!input.deg &&
    Number.isFinite(input.deg.degRatePerLapS) &&
    input.deg.degRatePerLapS !== 0 &&
    input.deg.confidence01 >= DEG_CONFIDENCE_FLOOR;

  const evaluate = (numStints: number): StintCountChoice => {
    const sizes = distributeLaps(raceLaps, numStints);
    const degCostS = degCostForSizes(sizes, input.deg);
    const pitCostS = (numStints - 1) * (pitLossS ?? 0);
    return { numStints, sizes, degCostS, pitCostS, totalComparableS: degCostS + pitCostS };
  };

  if (!canTradeoff) return evaluate(minStints); // prefer fewer stops when the trade-off is unknown

  const maxExtra = Math.max(0, Math.floor(input.maxExtraStops ?? DEFAULT_MAX_EXTRA_STOPS));
  let best = evaluate(minStints);
  for (let m = minStints + 1; m <= minStints + maxExtra; m += 1) {
    const candidate = evaluate(m);
    // Strict improvement only ⇒ ties keep the *fewer* stops (we iterate ascending).
    if (candidate.totalComparableS < best.totalComparableS) best = candidate;
  }
  return best;
};

/**
 * Plan the stint sequence (docs/05 §4) as a schema-valid {@link StintPlan}, or null when nothing is
 * plannable. `fuelAddLiters` is the fuel to load **at the start of that stint** — for stint 0 the
 * recommended starting fill (`laps·perLap + reserve`, capped at the tank), for later stints the
 * top-up to cover that stint (`laps·perLap`), assuming each stint is run to length and arrives at
 * the stop with ~reserve remaining. `pitWindows` give each stop a `[earliest, latest]` lap range:
 * latest = the fuel/tyre hard cap, earliest = as early as the *next* stint can still absorb.
 */
export const planStints = (input: StintPlannerInput): StintPlan | null => {
  const choice = optimizeStintCount(input);
  if (!choice) return null;

  const startLap = Math.max(0, Math.floor(input.startLap ?? 0));
  const perLap = input.perLapFuelLiters;
  const reserve = input.reserveLiters ?? perLap;
  const tank = input.tankCapacityLiters;
  const tireCompound = input.tireCompound ?? null;

  const fuelCap = maxStintLapsByFuel(tank, perLap, reserve);
  const tireCapLaps =
    input.maxStintLapsByTire != null && input.maxStintLapsByTire > 0
      ? Math.floor(input.maxStintLapsByTire)
      : Infinity;
  const maxStint = Math.min(fuelCap, tireCapLaps);

  let lap = startLap;
  const stints = choice.sizes.map((laps, index) => {
    const start = lap;
    const end = lap + laps;
    lap = end;
    const fuelForStint = laps * perLap;
    const fuelAddLiters =
      index === 0 ? Math.min(tank, fuelForStint + reserve) : Math.min(tank, fuelForStint);
    // Tyre life consumed this stint, if a tyre limit is known; else unknown ⇒ 0.
    const expectedDegradation01 = Number.isFinite(tireCapLaps) ? clamp01(laps / tireCapLaps) : 0;
    return {
      index,
      startLap: start,
      endLap: end,
      fuelAddLiters,
      tireCompound,
      expectedDegradation01,
    };
  });

  // One pit window per stop (between consecutive stints).
  const fuelLimited = fuelCap <= tireCapLaps;
  const tyreLimited = tireCapLaps <= fuelCap;
  const baseReason =
    fuelLimited && tyreLimited
      ? 'fuel and tyre-limited'
      : fuelLimited
        ? 'fuel-limited'
        : 'tyre-limited';
  const mandatoryStops = Math.max(0, Math.floor(input.mandatoryStops ?? 0));
  const mandatoryDriven = choice.numStints > Math.ceil(Math.floor(input.raceLaps) / maxStint);

  const pitWindows = stints.slice(0, -1).map((stint, k) => {
    const nextLaps = choice.sizes[k + 1] ?? 0;
    const latestLap = stint.startLap + maxStint; // run this stint to the fuel/tyre cap
    const earliestLap = Math.max(stint.startLap + 1, stint.endLap - (maxStint - nextLaps));
    const reason = mandatoryDriven ? `${baseReason} (mandatory stop)` : baseReason;
    return { earliestLap, latestLap, reason };
  });

  return {
    stints,
    pitWindows,
    mandatoryStopsRemaining: input.mandatoryStops != null ? mandatoryStops : null,
  };
};
