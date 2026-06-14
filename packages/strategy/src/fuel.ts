import type { FuelPlan } from '@race-engineer/core';

/**
 * Fuel model (docs/05 §1). Pure, deterministic — the LLM calls these as tools and phrases
 * the result; it never reproduces the math (CLAUDE.md rule 1). Every estimate carries a
 * `confidence01` so the engineer can hedge ("trustworthy or silent").
 */

const DEFAULT_WINDOW = 5;
const DEFAULT_PRIOR_WEIGHT = 3;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Median — a robust average that ignores the odd contaminated lap. Caller ensures non-empty. */
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  return ((sorted[mid - 1] ?? hi) + hi) / 2;
};

/**
 * Turn a series of fuel-level readings taken at lap boundaries into per-lap consumption
 * deltas. Drops in fuel are consumption; increases (refuels) are excluded.
 */
export const fuelDeltasFromReadings = (readings: readonly number[]): number[] => {
  const deltas: number[] = [];
  for (let i = 1; i < readings.length; i += 1) {
    const prev = readings[i - 1];
    const curr = readings[i];
    if (prev === undefined || curr === undefined) continue;
    const delta = prev - curr;
    if (delta > 0) deltas.push(delta);
  }
  return deltas;
};

/** A learned prior for fuel consumption (per car/track/conditions), from `fuel_models`. */
export interface FuelPrior {
  meanLitersPerLap: number;
  /** Effective sample weight of the prior (higher = trust the prior more). */
  weight?: number;
}

export interface ConsumptionInput {
  /** Per-lap fuel deltas from completed GREEN-flag laps only (exclude in/out, FCY, pit). */
  greenLapFuelDeltas: readonly number[];
  prior?: FuelPrior | null;
  /** Robust-mean window (default 5 most-recent laps). */
  window?: number;
}

export interface FuelConsumption {
  /** Blended per-lap consumption (L/lap), or null when there is nothing to estimate from. */
  perLapLiters: number | null;
  confidence01: number;
  sampleCount: number;
}

/**
 * Robust rolling per-lap consumption, blended with a learned prior (docs/05 §1):
 *   perLap     = (priorWeight*priorMean + n*sampleMean) / (priorWeight + n)
 *   confidence = n / (n + priorWeight)
 */
export const estimatePerLapConsumption = (input: ConsumptionInput): FuelConsumption => {
  const window = Math.max(1, Math.floor(input.window ?? DEFAULT_WINDOW));
  const samples = input.greenLapFuelDeltas
    .filter((d) => Number.isFinite(d) && d > 0)
    .slice(-window);
  const sampleCount = samples.length;
  const prior = input.prior ?? null;
  const priorWeight = Math.max(0, prior?.weight ?? DEFAULT_PRIOR_WEIGHT);

  if (sampleCount === 0) {
    // No live samples: lean entirely on the prior (if any); confidence in live data is 0.
    return { perLapLiters: prior ? prior.meanLitersPerLap : null, confidence01: 0, sampleCount: 0 };
  }

  const sampleMean = median(samples);
  const perLapLiters = prior
    ? (priorWeight * prior.meanLitersPerLap + sampleCount * sampleMean) /
      (priorWeight + sampleCount)
    : sampleMean;

  return {
    perLapLiters,
    confidence01: clamp01(sampleCount / (sampleCount + priorWeight)),
    sampleCount,
  };
};

export interface RacePace {
  /** Time remaining in a timed race (s). */
  remainingS: number;
  /** Current green-flag average lap time (s). */
  avgGreenLapS: number;
  /** Add a lap if the leader will start a final lap as the clock hits zero. */
  addFinalLap?: boolean;
}

export interface FuelPlanInput {
  fuelLiters: number;
  consumption: FuelConsumption;
  /** Timed-race pace for fuel-to-finish; omit for an unknown/lap-count race. */
  race?: RacePace | null;
  /** Safety margin to keep in the tank (default ~1 lap's worth). */
  reserveLiters?: number;
  /** Laps until the planned stop, to compute a fuel-save target. */
  lapsUntilPlannedStop?: number | null;
}

/**
 * Compute a {@link FuelPlan} from a consumption estimate + fuel state (+ optional timed-race
 * pace). Returns null when per-lap consumption is unknown — "still learning", say nothing.
 */
export const computeFuelPlan = (input: FuelPlanInput): FuelPlan | null => {
  const perLapLiters = input.consumption.perLapLiters;
  if (perLapLiters === null || !(perLapLiters > 0)) return null;

  const fuelLiters = Math.max(0, input.fuelLiters);
  const reserveLiters = input.reserveLiters ?? perLapLiters;
  const lapsRemainingOnFuel = fuelLiters / perLapLiters;

  let lapsToFinish: number | null = null;
  if (input.race && input.race.avgGreenLapS > 0 && input.race.remainingS >= 0) {
    lapsToFinish =
      Math.ceil(input.race.remainingS / input.race.avgGreenLapS) + (input.race.addFinalLap ? 1 : 0);
  }

  const litersToFinish = lapsToFinish === null ? null : lapsToFinish * perLapLiters;
  const litersToAddNextStop =
    litersToFinish === null ? null : Math.max(0, litersToFinish - fuelLiters + reserveLiters);

  let fuelSaveTargetLitersPerLap: number | null = null;
  const lapsUntilStop = input.lapsUntilPlannedStop ?? null;
  if (lapsUntilStop !== null && lapsUntilStop > 0 && lapsRemainingOnFuel < lapsUntilStop) {
    const needPerLap = fuelLiters / lapsUntilStop;
    const save = perLapLiters - needPerLap;
    fuelSaveTargetLitersPerLap = save > 0 ? save : null;
  }

  return {
    perLapLiters,
    lapsRemainingOnFuel,
    lapsToFinish,
    litersToFinish,
    litersToAddNextStop,
    fuelSaveTargetLitersPerLap,
    confidence01: clamp01(input.consumption.confidence01),
  };
};
