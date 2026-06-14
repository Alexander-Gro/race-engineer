import type { RaceState } from '@race-engineer/core';

/**
 * Lap-time contamination hygiene (docs/05 §6, last bullet): "when computing pace/fuel, down-weight
 * laps spent stuck behind traffic so estimates are not poisoned." Pure, deterministic — keeps the
 * fuel (T3.1) and tyre (T7.1) estimators honest by excluding dirty-air laps from their sample set.
 *
 * Two pieces:
 *  - {@link isStuckBehindTraffic} — a per-tick predicate (a car sitting just ahead in dirty air), to
 *    be accumulated over a lap into a contaminated-fraction.
 *  - {@link lapTrafficWeight} / {@link cleanLapValues} — turn that fraction into a sample weight and
 *    drop the laps too contaminated to trust before they reach the (median-based) consumption model.
 */

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export interface StuckOptions {
  /** A car within this time gap *ahead* puts you in its dirty air ⇒ pace contaminated (s). Default 1. */
  stuckGapS?: number;
  /** Only count a *different* class as contaminating (else any car ahead). Default false. */
  differentClassOnly?: boolean;
}

/**
 * Is the player running in traffic right now — a car sitting just ahead within the dirty-air gap?
 * Per-tick; accumulate the fraction of a lap for which this holds to get the lap's contamination.
 */
export const isStuckBehindTraffic = (state: RaceState, options: StuckOptions = {}): boolean => {
  const stuckGapS = Math.max(0, options.stuckGapS ?? 1);
  const player = state.player;
  if (player.pit.inPitLane) return false;

  for (const car of state.cars) {
    if (car.isPlayer || car.id === player.id || car.pit.inPitLane) continue;
    if (car.gapToPlayerS === null) continue;
    // Just ahead (gap < 0) and within the dirty-air window.
    if (car.gapToPlayerS < 0 && -car.gapToPlayerS <= stuckGapS) {
      if (
        options.differentClassOnly &&
        player.className !== null &&
        car.className !== null &&
        player.className === car.className
      ) {
        continue; // same-class racing isn't "traffic" for pace-hygiene purposes
      }
      return true;
    }
  }
  return false;
};

export interface LapWeightOptions {
  /** Above this contaminated fraction the lap is fully discarded (weight 0). Default 1 (never). */
  discardAbove01?: number;
}

/**
 * Sample weight for a lap given the fraction of it spent stuck in traffic: `1 − fraction` (linear
 * down-weight), or 0 once the fraction exceeds `discardAbove01`. Always in [0, 1].
 */
export const lapTrafficWeight = (
  contaminatedFraction01: number,
  options: LapWeightOptions = {},
): number => {
  const fraction = clamp01(contaminatedFraction01);
  const discardAbove = options.discardAbove01 ?? 1;
  if (fraction > discardAbove) return 0;
  return clamp01(1 - fraction);
};

/** A completed lap's estimation value (fuel delta or lap time) tagged with its traffic contamination. */
export interface ContaminatedLapSample {
  value: number;
  /** Fraction of the lap spent stuck behind traffic (0 = clean, 1 = the whole lap). */
  contaminatedFraction01: number;
}

export interface CleanLapOptions extends LapWeightOptions {
  /** Keep only laps whose traffic weight is at least this (default 0.5 ⇒ drop laps >50% in traffic). */
  minWeight?: number;
}

/**
 * Filter a set of lap samples down to the ones clean enough to trust, returning their bare values for
 * the consumption/pace estimators (e.g. feed into `estimatePerLapConsumption({ greenLapFuelDeltas })`).
 * This is the "down-weight" of docs/05 §6 applied as a hard cut at `minWeight` — the median-based fuel
 * model already wants *clean* green laps only, so a heavily-contaminated lap simply isn't one.
 */
export const cleanLapValues = (
  samples: readonly ContaminatedLapSample[],
  options: CleanLapOptions = {},
): number[] => {
  const minWeight = options.minWeight ?? 0.5;
  return samples
    .filter((s) => lapTrafficWeight(s.contaminatedFraction01, options) >= minWeight)
    .map((s) => s.value);
};
