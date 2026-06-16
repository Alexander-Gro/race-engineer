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
 * Turn a series of level readings taken at lap boundaries into per-lap consumption deltas.
 * Drops are consumption; increases (refuels / VE refills) are excluded. Shared by fuel and
 * Virtual Energy — both are monotonically-decreasing budgets that jump back up at a stop.
 */
const consumptionDeltas = (readings: readonly number[]): number[] => {
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

/** Per-lap fuel-consumption deltas (L/lap) from lap-boundary fuel-level readings. */
export const fuelDeltasFromReadings = (readings: readonly number[]): number[] =>
  consumptionDeltas(readings);

/** Per-lap Virtual-Energy deltas (0..1 of the budget / lap) from lap-boundary VE readings. */
export const energyDeltasFromReadings01 = (readings: readonly number[]): number[] =>
  consumptionDeltas(readings);

interface BlendResult {
  /** Blended per-lap value, or null when there is nothing to estimate from. */
  value: number | null;
  confidence01: number;
  sampleCount: number;
}

/**
 * Robust rolling per-lap consumption blended with a learned prior (docs/05 §1):
 *   value      = (priorWeight*priorMean + n*sampleMean) / (priorWeight + n)
 *   confidence = n / (n + priorWeight)
 * Median over the most-recent `window` positive deltas (ignores the odd contaminated lap).
 * Identical math for fuel (litres) and Virtual Energy (0..1) — the unit is the caller's.
 */
const blendConsumption = (
  deltas: readonly number[],
  priorMean: number | null,
  priorWeight: number | undefined,
  window: number | undefined,
): BlendResult => {
  const win = Math.max(1, Math.floor(window ?? DEFAULT_WINDOW));
  const samples = deltas.filter((d) => Number.isFinite(d) && d > 0).slice(-win);
  const sampleCount = samples.length;
  const pw = Math.max(0, priorWeight ?? DEFAULT_PRIOR_WEIGHT);

  if (sampleCount === 0) {
    // No live samples: lean entirely on the prior (if any); confidence in live data is 0.
    return { value: priorMean, confidence01: 0, sampleCount: 0 };
  }

  const sampleMean = median(samples);
  const value =
    priorMean !== null
      ? (pw * priorMean + sampleCount * sampleMean) / (pw + sampleCount)
      : sampleMean;

  return { value, confidence01: clamp01(sampleCount / (sampleCount + pw)), sampleCount };
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

/** Robust rolling per-lap fuel consumption, blended with a learned prior (docs/05 §1). */
export const estimatePerLapConsumption = (input: ConsumptionInput): FuelConsumption => {
  const prior = input.prior ?? null;
  const { value, confidence01, sampleCount } = blendConsumption(
    input.greenLapFuelDeltas,
    prior ? prior.meanLitersPerLap : null,
    prior?.weight,
    input.window,
  );
  return { perLapLiters: value, confidence01, sampleCount };
};

/** A learned prior for Virtual-Energy consumption (per car/track/conditions), 0..1 / lap. */
export interface EnergyPrior {
  meanPerLap01: number;
  /** Effective sample weight of the prior (higher = trust the prior more). */
  weight?: number;
}

export interface EnergyConsumptionInput {
  /** Per-lap VE deltas (0..1 of budget) from completed GREEN-flag laps only. */
  greenLapEnergyDeltas01: readonly number[];
  prior?: EnergyPrior | null;
  /** Robust-mean window (default 5 most-recent laps). */
  window?: number;
}

export interface EnergyConsumption {
  /** Blended per-lap VE burn (0..1 / lap), or null when there is nothing to estimate from. */
  perLap01: number | null;
  confidence01: number;
  sampleCount: number;
}

/**
 * Robust rolling per-lap Virtual-Energy burn, blended with a learned prior. Identical
 * estimator to {@link estimatePerLapConsumption} but over the 0..1 VE budget — in LMU this
 * is frequently the binding constraint, so it must be tracked with the same rigour as fuel.
 */
export const estimatePerLapEnergy = (input: EnergyConsumptionInput): EnergyConsumption => {
  const prior = input.prior ?? null;
  const { value, confidence01, sampleCount } = blendConsumption(
    input.greenLapEnergyDeltas01,
    prior ? prior.meanPerLap01 : null,
    prior?.weight,
    input.window,
  );
  return { perLap01: value, confidence01, sampleCount };
};

export interface RacePace {
  /** Time remaining in a timed race (s). */
  remainingS: number;
  /** Current green-flag average lap time (s). */
  avgGreenLapS: number;
  /** Add a lap if the leader will start a final lap as the clock hits zero. */
  addFinalLap?: boolean;
}

/** Virtual-Energy state for the plan (LMU). Omit/null for series without VE. */
export interface EnergyPlanInput {
  /** VE remaining now, 0..1 of the per-stint budget. */
  level01: number;
  consumption: EnergyConsumption;
  /** Safety margin of VE to keep (default ~1 lap's worth). */
  reserve01?: number;
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
  /**
   * Virtual Energy (LMU). When present, the plan also computes the VE-limited laps and sets
   * `bindingConstraint` to whichever of fuel/VE runs out first — the actual stint limit. Omit
   * for fuel-only series; the VE figures are then all null and fuel planning is unchanged.
   */
  energy?: EnergyPlanInput | null;
}

/**
 * Compute a {@link FuelPlan} from a consumption estimate + fuel state (+ optional timed-race
 * pace and Virtual Energy). Returns null when per-lap *fuel* consumption is unknown — "still
 * learning", say nothing. When VE is supplied, the binding stint/finish constraint is
 * min(fuel-limited laps, VE-limited laps): a car can have fuel but be out of energy.
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

  const lapsUntilStop = input.lapsUntilPlannedStop ?? null;
  let fuelSaveTargetLitersPerLap: number | null = null;
  if (lapsUntilStop !== null && lapsUntilStop > 0 && lapsRemainingOnFuel < lapsUntilStop) {
    const needPerLap = fuelLiters / lapsUntilStop;
    const save = perLapLiters - needPerLap;
    fuelSaveTargetLitersPerLap = save > 0 ? save : null;
  }

  // --- Virtual Energy side (LMU). Mirrors the fuel math over the 0..1 budget. All null when
  //     VE isn't exposed or its per-lap burn is still unknown (we never guess a rate). ---
  const energy = input.energy ?? null;
  const perLapEnergy01 =
    energy && energy.consumption.perLap01 !== null && energy.consumption.perLap01 > 0
      ? energy.consumption.perLap01
      : null;
  const level01 = energy ? clamp01(Math.max(0, energy.level01)) : null;
  const lapsRemainingOnEnergy =
    perLapEnergy01 !== null && level01 !== null ? level01 / perLapEnergy01 : null;
  const energyReserve01 = energy?.reserve01 ?? perLapEnergy01 ?? 0;
  const energyToFinish01 =
    lapsToFinish === null || perLapEnergy01 === null ? null : lapsToFinish * perLapEnergy01;
  const energyToAddNextStop01 =
    energyToFinish01 === null || level01 === null
      ? null
      : Math.max(0, energyToFinish01 - level01 + energyReserve01);

  let energySaveTargetPerLap01: number | null = null;
  if (
    perLapEnergy01 !== null &&
    level01 !== null &&
    lapsUntilStop !== null &&
    lapsUntilStop > 0 &&
    lapsRemainingOnEnergy !== null &&
    lapsRemainingOnEnergy < lapsUntilStop
  ) {
    const need01 = level01 / lapsUntilStop;
    const save = perLapEnergy01 - need01;
    energySaveTargetPerLap01 = save > 0 ? save : null;
  }

  // Which resource binds the stint: the one with fewer laps left. Ties favour fuel (the
  // historically-tracked one); null when VE laps are unknown → fuel-only planning.
  const bindingConstraint: FuelPlan['bindingConstraint'] =
    lapsRemainingOnEnergy === null
      ? null
      : lapsRemainingOnEnergy < lapsRemainingOnFuel
        ? 'energy'
        : 'fuel';

  return {
    perLapLiters,
    lapsRemainingOnFuel,
    lapsToFinish,
    litersToFinish,
    litersToAddNextStop,
    fuelSaveTargetLitersPerLap,
    perLapEnergy01,
    lapsRemainingOnEnergy,
    energyToFinish01,
    energyToAddNextStop01,
    energySaveTargetPerLap01,
    bindingConstraint,
    confidence01: clamp01(input.consumption.confidence01),
  };
};
