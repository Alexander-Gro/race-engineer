import type { TirePrior } from '@race-engineer/strategy';
import type { Db } from '../db';
import {
  addSample,
  DEFAULT_MAX_PRIOR_WEIGHT,
  EMPTY_TIRE_STATS,
  tirePriorFromStats,
  tireStatsFromRecord,
} from '../priors';
import type { TireModelKey, TireModelRecord } from '../types';

/** Raw `tire_models` row. */
interface TireModelRow {
  car: string;
  track: string;
  compound: string;
  deg_rate_per_lap_s_mean: number;
  deg_rate_per_lap_s_stdev: number;
  base_lap_s_mean: number;
  base_lap_s_stdev: number;
  samples: number;
  updated_at: number;
}

const toRecord = (row: TireModelRow): TireModelRecord => ({
  car: row.car,
  track: row.track,
  compound: row.compound,
  degRatePerLapSMean: row.deg_rate_per_lap_s_mean,
  degRatePerLapSStdev: row.deg_rate_per_lap_s_stdev,
  baseLapSMean: row.base_lap_s_mean,
  baseLapSStdev: row.base_lap_s_stdev,
  samples: row.samples,
  updatedAt: row.updated_at,
});

/** One learning sample: a completed stint's fitted degradation line (docs/05 §2). */
export interface TireStintFit {
  /** Fitted slope — seconds lost per stint-lap. */
  degRatePerLapS: number;
  /** Fitted intercept — fresh-tyre lap time (s). */
  baseLapS: number;
}

/**
 * The tyre learning store (docs/04 `tire_models`, docs/05 §2) — the fuel layer's pattern applied to
 * degradation. One row per car/track/compound bucket; {@link TireModelRepo.record} folds each
 * completed stint's fitted slope + intercept into running stats so a future stint seeds
 * `fitTireDegradation` from history instead of a blank slate. Accumulation spans sessions — the
 * bucket key intentionally omits session id. Read-only toward the game; the LLM never touches this.
 */
export class TireModelRepo {
  constructor(private readonly db: Db) {}

  /** Fetch the learned model for a bucket, or null if none learned yet. */
  get(key: TireModelKey): TireModelRecord | null {
    const row = this.db
      .prepare(
        'SELECT * FROM tire_models WHERE car = @car AND track = @track AND compound = @compound',
      )
      .get(key) as TireModelRow | undefined;
    return row ? toRecord(row) : null;
  }

  /**
   * Fold one completed stint's fitted line into the bucket's running stats and persist. `now`
   * (epoch ms) is injected so this stays deterministic and testable (no hidden clock).
   */
  record(key: TireModelKey, fit: TireStintFit, now: number): TireModelRecord {
    const prev = this.get(key);
    const stats = prev ? tireStatsFromRecord(prev) : EMPTY_TIRE_STATS;
    const degRate = addSample(stats.degRate, fit.degRatePerLapS);
    const baseLap = addSample(stats.baseLap, fit.baseLapS);
    this.db
      .prepare(
        `INSERT INTO tire_models
           (car, track, compound, deg_rate_per_lap_s_mean, deg_rate_per_lap_s_stdev,
            base_lap_s_mean, base_lap_s_stdev, samples, updated_at)
         VALUES (@car, @track, @compound, @degMean, @degStdev, @baseMean, @baseStdev, @samples, @updatedAt)
         ON CONFLICT(car, track, compound) DO UPDATE SET
           deg_rate_per_lap_s_mean  = excluded.deg_rate_per_lap_s_mean,
           deg_rate_per_lap_s_stdev = excluded.deg_rate_per_lap_s_stdev,
           base_lap_s_mean          = excluded.base_lap_s_mean,
           base_lap_s_stdev         = excluded.base_lap_s_stdev,
           samples                  = excluded.samples,
           updated_at               = excluded.updated_at`,
      )
      .run({
        car: key.car,
        track: key.track,
        compound: key.compound,
        degMean: degRate.mean,
        degStdev: degRate.stdev,
        baseMean: baseLap.mean,
        baseStdev: baseLap.stdev,
        samples: degRate.samples,
        updatedAt: now,
      });
    return {
      ...key,
      degRatePerLapSMean: degRate.mean,
      degRatePerLapSStdev: degRate.stdev,
      baseLapSMean: baseLap.mean,
      baseLapSStdev: baseLap.stdev,
      samples: degRate.samples,
      updatedAt: now,
    };
  }

  /**
   * The {@link TirePrior} for a bucket, ready to feed `fitTireDegradation` — null when nothing is
   * learned (the tyre model then stays silent rather than guessing).
   */
  getPrior(key: TireModelKey, maxWeight: number = DEFAULT_MAX_PRIOR_WEIGHT): TirePrior | null {
    const record = this.get(key);
    return record ? tirePriorFromStats(tireStatsFromRecord(record), maxWeight) : null;
  }
}
