import type { Tire } from '@race-engineer/core';

/**
 * Tire-degradation model (docs/05 §2). Pure, deterministic — the LLM calls these as tools and
 * phrases the result; it never reproduces the math (CLAUDE.md rule 1). Every estimate carries a
 * `confidence01` so the engineer can hedge ("trustworthy or silent").
 *
 * Kept deliberately simple (docs/05 §2: over-modelling tyre physics is a rabbit hole): a linear
 * fit of green-flag lap time vs lap-into-stint —
 *   lapTime(stintLap) ≈ baseLapS + degRatePerLapS · stintLap
 * — blended with a learned prior, plus a temperature-window check. That covers end-of-stint pace,
 * compound comparison, and double-stint feasibility (the stint planner, T7.3, consumes this).
 */

const DEFAULT_WINDOW = 8;
const DEFAULT_PRIOR_WEIGHT = 3;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A green-flag lap within the current stint. Exclude in/out, FCY, and traffic-contaminated laps. */
export interface TireLapSample {
  /** Lap number within the stint (1 = first flying lap on these tyres). */
  stintLap: number;
  lapTimeS: number;
}

/** A learned degradation prior (per car/track/compound), from `tire_models`. */
export interface TirePrior {
  /** Prior degradation rate: seconds lost per lap of stint. */
  degRatePerLapS: number;
  /** Optional prior fresh-tyre pace (intercept at stint lap 0). */
  baseLapS?: number | null;
  /** Effective sample weight of the prior (higher = trust the prior more). */
  weight?: number;
}

export interface TireDegInput {
  greenStintLaps: readonly TireLapSample[];
  prior?: TirePrior | null;
  /** Most-recent N stint laps to fit (default 8). */
  window?: number;
}

export interface TireDegradation {
  /** Seconds lost per lap of stint (the fitted/blended slope). ~0 = stable; <0 = still warming up. */
  degRatePerLapS: number;
  /** Fresh-tyre baseline lap time (intercept at stint lap 0), or null when not estimable. */
  baseLapS: number | null;
  /** Shrinks with low sample size; 0 ⇒ no usable signal (stay silent). */
  confidence01: number;
  sampleCount: number;
}

/**
 * Fit the degradation line from green stint laps, blended with a prior (docs/05 §2):
 *   slope/intercept = least-squares fit of lapTime on stintLap
 *   degRate = (priorWeight·priorDeg + n·slope) / (priorWeight + n)
 *   confidence = n / (n + priorWeight)
 * Returns `confidence01: 0` (and `baseLapS: null`) when there is no usable signal.
 */
export const fitTireDegradation = (input: TireDegInput): TireDegradation => {
  const window = Math.max(1, Math.floor(input.window ?? DEFAULT_WINDOW));
  const samples = input.greenStintLaps
    .filter((s) => Number.isFinite(s.stintLap) && Number.isFinite(s.lapTimeS) && s.lapTimeS > 0)
    .slice(-window);
  const n = samples.length;
  const prior = input.prior ?? null;
  const priorWeight = Math.max(0, prior?.weight ?? DEFAULT_PRIOR_WEIGHT);

  // Least-squares fit needs ≥2 laps spanning ≥2 distinct stint-lap values.
  let fittedSlope: number | null = null;
  let fittedIntercept: number | null = null;
  if (n >= 2) {
    const xs = samples.map((s) => s.stintLap);
    const ys = samples.map((s) => s.lapTimeS);
    const xbar = mean(xs);
    const ybar = mean(ys);
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = (xs[i] ?? 0) - xbar;
      sxx += dx * dx;
      sxy += dx * ((ys[i] ?? 0) - ybar);
    }
    if (sxx > 0) {
      fittedSlope = sxy / sxx;
      fittedIntercept = ybar - fittedSlope * xbar;
    }
  }

  // No fit and no prior → nothing trustworthy to say.
  if (fittedSlope === null && !prior) {
    return { degRatePerLapS: 0, baseLapS: null, confidence01: 0, sampleCount: n };
  }

  const priorDeg = prior?.degRatePerLapS ?? 0;
  const degRatePerLapS =
    fittedSlope === null
      ? priorDeg
      : prior
        ? (priorWeight * priorDeg + n * fittedSlope) / (priorWeight + n)
        : fittedSlope;

  const priorBase = prior?.baseLapS ?? null;
  let baseLapS: number | null;
  if (fittedIntercept !== null && priorBase !== null) {
    baseLapS = (priorWeight * priorBase + n * fittedIntercept) / (priorWeight + n);
  } else {
    baseLapS = fittedIntercept ?? priorBase;
  }

  return { degRatePerLapS, baseLapS, confidence01: clamp01(n / (n + priorWeight)), sampleCount: n };
};

/** Predicted lap time at a given lap into the stint, or null when the baseline is unknown. */
export const predictLapTimeS = (deg: TireDegradation, stintLap: number): number | null =>
  deg.baseLapS === null ? null : deg.baseLapS + deg.degRatePerLapS * stintLap;

/**
 * Cumulative seconds lost to degradation over a stint of `stintLaps` laps, relative to the
 * fresh-tyre baseline: Σ_{lap=1..N} degRate·lap = degRate · N(N+1)/2. The strategic cost of a
 * longer stint — compare against pit-loss (T7.2) for double-stint decisions (T7.3).
 */
export const degLossOverStintS = (deg: TireDegradation, stintLaps: number): number => {
  const n = Math.max(0, Math.floor(stintLaps));
  return (deg.degRatePerLapS * (n * (n + 1))) / 2;
};

// --- Temperature window (docs/05 §2: tyre temps vs target window) ----------------------------

export type TireWindowStatus = 'cold' | 'in-window' | 'hot';
/** A compound's target operating-temperature window (°C). */
export interface TempWindow {
  minC: number;
  maxC: number;
}

const representativeTempC = (tempC: Tire['tempC']): number =>
  typeof tempC === 'number' ? tempC : (tempC.inner + tempC.center + tempC.outer) / 3;

/** Classify one tyre's temperature against its target window. */
export const assessTireWindow = (tempC: Tire['tempC'], window: TempWindow): TireWindowStatus => {
  const temp = representativeTempC(tempC);
  if (temp < window.minC) return 'cold';
  if (temp > window.maxC) return 'hot';
  return 'in-window';
};

export type OverallTireWindow = TireWindowStatus | 'mixed';

/**
 * Per-wheel window status + an overall summary ([FL, FR, RL, RR] order). `mixed` = some hot and
 * some cold at once (e.g. fronts overheating, rears cold) — strategically distinct from uniformly
 * hot or cold.
 */
export const assessTireWindows = (
  tires: readonly Tire[],
  window: TempWindow,
): { perWheel: TireWindowStatus[]; overall: OverallTireWindow } => {
  const perWheel = tires.map((t) => assessTireWindow(t.tempC, window));
  const hasHot = perWheel.includes('hot');
  const hasCold = perWheel.includes('cold');
  const overall: OverallTireWindow =
    hasHot && hasCold ? 'mixed' : hasHot ? 'hot' : hasCold ? 'cold' : 'in-window';
  return { perWheel, overall };
};
