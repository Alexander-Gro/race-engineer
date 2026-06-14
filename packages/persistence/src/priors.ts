import type { FuelPrior } from '@race-engineer/strategy';
import type { FuelModelRecord } from './types';

/**
 * The learning layer's pure math (docs/05 §1 & §8). Kept free of any DB knowledge so it is
 * trivially unit-testable; the repos persist its output. No randomness, no I/O.
 */

/** Running mean/standard-deviation of a sample stream — the persisted shape of a model. */
export interface RunningStats {
  mean: number;
  /** Sample standard deviation (0 for n < 2). */
  stdev: number;
  samples: number;
}

export const EMPTY_STATS: RunningStats = { mean: 0, stdev: 0, samples: 0 };

/**
 * Fold one new sample into running stats with Welford's online algorithm — numerically
 * stable and O(1), so we never re-read the whole lap history to update a model.
 *
 * We persist only `mean`/`stdev`/`samples` (docs/04), so the sum-of-squares (M2) is
 * reconstructed from the stored stdev each step: `M2 = stdev² · (n − 1)`.
 */
export const addSample = (stats: RunningStats, x: number): RunningStats => {
  const n1 = stats.samples + 1;
  const m2Prev = stats.samples >= 2 ? stats.stdev * stats.stdev * (stats.samples - 1) : 0;
  const delta = x - stats.mean;
  const mean = stats.mean + delta / n1;
  const delta2 = x - mean;
  const m2 = m2Prev + delta * delta2;
  const variance = n1 >= 2 ? m2 / (n1 - 1) : 0;
  return { mean, stdev: Math.sqrt(Math.max(0, variance)), samples: n1 };
};

/**
 * How much weight a fully-learned prior may carry in the fuel blend, expressed as a count
 * of "virtual" green laps. Capped so a model with hundreds of historical laps still lets a
 * handful of *live* laps dominate — track grip, fuel load, and setup drift session to
 * session, so the prior is a good seed, not gospel.
 */
export const DEFAULT_MAX_PRIOR_WEIGHT = 5;

/**
 * Convert a learned fuel model into a {@link FuelPrior} the fuel model can blend with live
 * laps (`@race-engineer/strategy`). Weight grows monotonically with sample count and
 * saturates at `maxWeight`, so more history ⇒ a more trusted seed, up to the cap. Returns
 * null when there is nothing learned yet (so the engineer stays silent rather than guessing).
 */
export const fuelPriorFromStats = (
  stats: RunningStats,
  maxWeight: number = DEFAULT_MAX_PRIOR_WEIGHT,
): FuelPrior | null => {
  if (stats.samples <= 0 || !(stats.mean > 0)) return null;
  return {
    meanLitersPerLap: stats.mean,
    weight: Math.min(stats.samples, Math.max(0, maxWeight)),
  };
};

/** A persisted {@link FuelModelRecord} carries exactly the running-stats fields. */
export const statsFromRecord = (record: FuelModelRecord): RunningStats => ({
  mean: record.perLapLMean,
  stdev: record.perLapLStdev,
  samples: record.samples,
});

/** Build a {@link FuelPrior} straight from a stored record (null if the record is empty). */
export const fuelPriorFromRecord = (
  record: FuelModelRecord | null | undefined,
  maxWeight: number = DEFAULT_MAX_PRIOR_WEIGHT,
): FuelPrior | null => (record ? fuelPriorFromStats(statsFromRecord(record), maxWeight) : null);
