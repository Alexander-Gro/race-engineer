import type { FuelPrior } from '@race-engineer/strategy';
import type { Db } from '../db';
import {
  addSample,
  DEFAULT_MAX_PRIOR_WEIGHT,
  EMPTY_STATS,
  fuelPriorFromStats,
  statsFromRecord,
} from '../priors';
import type { FuelModelKey, FuelModelRecord } from '../types';

/** Raw `fuel_models` row. */
interface FuelModelRow {
  car: string;
  track: string;
  conditions: string;
  per_lap_l_mean: number;
  per_lap_l_stdev: number;
  samples: number;
  updated_at: number;
}

const toRecord = (row: FuelModelRow): FuelModelRecord => ({
  car: row.car,
  track: row.track,
  conditions: row.conditions,
  perLapLMean: row.per_lap_l_mean,
  perLapLStdev: row.per_lap_l_stdev,
  samples: row.samples,
  updatedAt: row.updated_at,
});

/**
 * The learning layer's store (docs/04 `fuel_models`, docs/05 §1). One row per
 * car/track/conditions bucket; {@link FuelModelRepo.record} folds each new green-lap sample
 * into the running mean/stdev so future sessions start from a learned seed instead of a
 * blank slate. Accumulation spans sessions — the bucket key intentionally omits session id.
 */
export class FuelModelRepo {
  constructor(private readonly db: Db) {}

  /** Fetch the learned model for a bucket, or null if none learned yet. */
  get(key: FuelModelKey): FuelModelRecord | null {
    const row = this.db
      .prepare(
        'SELECT * FROM fuel_models WHERE car = @car AND track = @track AND conditions = @conditions',
      )
      .get(key) as FuelModelRow | undefined;
    return row ? toRecord(row) : null;
  }

  /**
   * Fold one green-lap fuel-used sample (liters) into the bucket's running stats and persist.
   * Returns the updated record. `now` (epoch ms) is passed in to keep this deterministic and
   * testable (no hidden clock).
   */
  record(key: FuelModelKey, fuelUsedLiters: number, now: number): FuelModelRecord {
    const existing = this.get(key);
    const next = addSample(existing ? statsFromRecord(existing) : EMPTY_STATS, fuelUsedLiters);
    this.db
      .prepare(
        `INSERT INTO fuel_models
           (car, track, conditions, per_lap_l_mean, per_lap_l_stdev, samples, updated_at)
         VALUES (@car, @track, @conditions, @mean, @stdev, @samples, @updatedAt)
         ON CONFLICT(car, track, conditions) DO UPDATE SET
           per_lap_l_mean  = excluded.per_lap_l_mean,
           per_lap_l_stdev = excluded.per_lap_l_stdev,
           samples         = excluded.samples,
           updated_at      = excluded.updated_at`,
      )
      .run({
        car: key.car,
        track: key.track,
        conditions: key.conditions,
        mean: next.mean,
        stdev: next.stdev,
        samples: next.samples,
        updatedAt: now,
      });
    return {
      ...key,
      perLapLMean: next.mean,
      perLapLStdev: next.stdev,
      samples: next.samples,
      updatedAt: now,
    };
  }

  /**
   * The {@link FuelPrior} for a bucket, ready to feed `estimatePerLapConsumption` — null when
   * nothing is learned (the fuel model then stays silent rather than guessing).
   */
  getPrior(key: FuelModelKey, maxWeight: number = DEFAULT_MAX_PRIOR_WEIGHT): FuelPrior | null {
    const record = this.get(key);
    return record ? fuelPriorFromStats(statsFromRecord(record), maxWeight) : null;
  }
}
