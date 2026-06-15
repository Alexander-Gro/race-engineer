import type { RaceState } from '@race-engineer/core';
import { StrategyEngine } from '@race-engineer/engineer-core';
import { fuelDeltasFromReadings } from '@race-engineer/strategy';

/**
 * Fuel-accuracy eval (docs/10 Phase-2 acceptance, docs/06 §Evaluation): replay a canonical
 * `RaceState` stream through the **same always-on {@link StrategyEngine} the app runs** and, at
 * each completed lap, compare its fuel estimate against the ground truth derived from the
 * recording itself. The headline gate is *"fuel-to-finish converges within ±1 lap by mid-stint"*.
 *
 * **Ground truth** is the recording's own measured per-lap consumption — the median of the actual
 * fuel drops across completed green laps (`fuelDeltasFromReadings`). So this is a self-consistency
 * eval: does the rolling estimator recover the true rate, and fast enough? It works on any
 * recording with fuel burn; on a flat-fuel slice (no completed laps / no burn) the model is
 * *expected to stay silent* — {@link FuelAccuracyResult.silent} — which is itself the docs/05 §8
 * "trustworthy or silent" honesty check (it must NOT fabricate a rate).
 *
 * Pure/deterministic and read-only: it only reads telemetry and runs the strategy math (which lives
 * in `@race-engineer/strategy` — CLAUDE.md rule 1; nothing here invents numbers).
 */

/** Per-lap-boundary comparison of the model's estimate against the recording's ground truth. */
export interface FuelAccuracySample {
  /** `lapsCompleted` at this lap boundary. */
  lap: number;
  /** Player fuel (L) at the boundary. */
  fuelLiters: number;
  /** The model's `confidence01` for this estimate. */
  confidence01: number;
  /** The model's per-lap consumption estimate (L/lap), or null while still learning. */
  predictedPerLapLiters: number | null;
  /** The model's laps-remaining-on-current-fuel, or null while still learning. */
  predictedLapsRemainingOnFuel: number | null;
  /** Ground-truth laps-remaining-on-fuel = `fuelLiters / groundTruthPerLapLiters`. */
  actualLapsRemainingOnFuel: number;
  /** |predicted − actual| laps-remaining (the ±1-lap gate metric), or null if no prediction yet. */
  lapsRemainingErrorAbs: number | null;
  /** |predicted − ground-truth| per-lap consumption (L), or null if no prediction yet. */
  perLapErrorAbs: number | null;
}

export interface FuelAccuracyResult {
  /** No completed green laps with a fuel drop → the model rightly produced no plan (honesty check). */
  silent: boolean;
  /** Recording-derived per-lap consumption (median of green-lap drops), or null when silent. */
  groundTruthPerLapLiters: number | null;
  /** Number of completed green laps that contributed a fuel-drop sample. */
  completedGreenLaps: number;
  samples: FuelAccuracySample[];
  /** The lap treated as "mid-stint" — the midpoint of the completed-lap samples. */
  midStintLap: number | null;
  /** Largest laps-remaining error across samples at/after mid-stint (the gate is ≤ tolerance). */
  midStintMaxLapsErrorAbs: number | null;
  /** docs/10 Phase-2 gate: every estimate from mid-stint on is within `lapsTolerance` of truth. */
  withinToleranceByMidStint: boolean;
  /** The highest confidence the model reached over the stream. */
  maxConfidence01: number;
}

export interface FuelAccuracyOptions {
  /** Laps-remaining tolerance for the mid-stint gate (docs/10 = ±1 lap). */
  lapsTolerance?: number;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2;
};

/** Was the player on a clean green lap at this frame (the laps the model is allowed to learn from)? */
const isGreen = (state: RaceState): boolean =>
  state.flags.global === 'green' && !state.player.pit.inPitLane;

export const evalFuelAccuracy = (
  frames: readonly RaceState[],
  options: FuelAccuracyOptions = {},
): FuelAccuracyResult => {
  const lapsTolerance = options.lapsTolerance ?? 1;

  // --- Pass 1: ground truth — the fuel level at the start, then at each green lap boundary. The
  // drop between consecutive readings is one lap's consumption; the median is robust to the odd
  // contaminated lap (the same robustness the model's estimator uses). ---
  const boundaryFuelReadings: number[] = [];
  let prevLaps: number | null = null;
  for (const f of frames) {
    const laps = f.player.lapsCompleted;
    if (prevLaps === null) {
      boundaryFuelReadings.push(f.player.fuel.liters); // start-of-recording fuel
    } else if (laps > prevLaps && isGreen(f)) {
      boundaryFuelReadings.push(f.player.fuel.liters); // fuel at this green lap boundary
    }
    prevLaps = laps;
  }
  const greenDrops = fuelDeltasFromReadings(boundaryFuelReadings);
  const groundTruthPerLapLiters = median(greenDrops);
  const completedGreenLaps = greenDrops.length;

  if (groundTruthPerLapLiters === null || !(groundTruthPerLapLiters > 0)) {
    return {
      silent: true,
      groundTruthPerLapLiters: null,
      completedGreenLaps,
      samples: [],
      midStintLap: null,
      midStintMaxLapsErrorAbs: null,
      withinToleranceByMidStint: true, // vacuously: nothing to be wrong about
      maxConfidence01: 0,
    };
  }

  // --- Pass 2: run the live StrategyEngine; sample its estimate at each lap boundary. ---
  const engine = new StrategyEngine();
  const samples: FuelAccuracySample[] = [];
  let maxConfidence01 = 0;
  prevLaps = null;
  for (const f of frames) {
    engine.observe(f);
    const laps = f.player.lapsCompleted;
    const isBoundary = prevLaps !== null && laps > prevLaps && isGreen(f);
    prevLaps = laps;
    if (!isBoundary) continue;

    const { fuelPlan } = engine.summary(f);
    const fuelLiters = f.player.fuel.liters;
    const actualLapsRemainingOnFuel = fuelLiters / groundTruthPerLapLiters;
    const predictedPerLapLiters = fuelPlan?.perLapLiters ?? null;
    const predictedLapsRemainingOnFuel = fuelPlan?.lapsRemainingOnFuel ?? null;
    const confidence01 = fuelPlan?.confidence01 ?? 0;
    maxConfidence01 = Math.max(maxConfidence01, confidence01);

    samples.push({
      lap: laps,
      fuelLiters,
      confidence01,
      predictedPerLapLiters,
      predictedLapsRemainingOnFuel,
      actualLapsRemainingOnFuel,
      lapsRemainingErrorAbs:
        predictedLapsRemainingOnFuel === null
          ? null
          : Math.abs(predictedLapsRemainingOnFuel - actualLapsRemainingOnFuel),
      perLapErrorAbs:
        predictedPerLapLiters === null
          ? null
          : Math.abs(predictedPerLapLiters - groundTruthPerLapLiters),
    });
  }

  // --- Gate: from mid-stint on, every prediction is within tolerance laps of the truth. ---
  const midIndex = Math.floor(samples.length / 2);
  const midStintLap = samples[midIndex]?.lap ?? null;
  const fromMidStint = samples
    .slice(midIndex)
    .map((s) => s.lapsRemainingErrorAbs)
    .filter((e): e is number => e !== null);
  const midStintMaxLapsErrorAbs = fromMidStint.length === 0 ? null : Math.max(...fromMidStint);
  const withinToleranceByMidStint =
    midStintMaxLapsErrorAbs === null ? true : midStintMaxLapsErrorAbs <= lapsTolerance;

  return {
    silent: false,
    groundTruthPerLapLiters,
    completedGreenLaps,
    samples,
    midStintLap,
    midStintMaxLapsErrorAbs,
    withinToleranceByMidStint,
    maxConfidence01,
  };
};
