/**
 * Storage record shapes for the persistence layer (docs/04 §Persistence schema).
 *
 * These are *storage* records, deliberately separate from the canonical `RaceState`
 * schema in `@race-engineer/core`: the DB keeps a flat, queryable history (sessions,
 * laps, learned models) while the hot loop speaks the rich per-tick schema. Times are
 * epoch milliseconds; fuel in liters; temps in °C — same units as the canonical model.
 */

/** A row to insert into `sessions` (the `id` is assigned by the DB). */
export interface NewSession {
  game: string;
  track?: string | null;
  car?: string | null;
  carClass?: string | null;
  /** Session kind, e.g. 'race' | 'practice' | 'qualifying'. */
  type?: string | null;
  server?: string | null;
  /** Epoch ms when the session started. */
  startedAt: number;
  /** Epoch ms when it ended, or null while live. */
  endedAt?: number | null;
}

/** A persisted `sessions` row. */
export interface SessionRecord {
  id: number;
  game: string;
  track: string | null;
  car: string | null;
  carClass: string | null;
  type: string | null;
  server: string | null;
  startedAt: number;
  endedAt: number | null;
}

/** A row to insert into `laps` (the `id` is assigned by the DB). */
export interface NewLap {
  sessionId: number;
  lapNo: number;
  lapTimeS?: number | null;
  /** Per-sector times (s); stored as JSON. */
  sectorTimesS?: readonly number[] | null;
  fuelUsedL?: number | null;
  fuelLeftL?: number | null;
  avgTireTempC?: number | null;
  /** 0 = worn out .. 1 = new (canonical direction, docs/04). */
  tireWear01?: number | null;
  compound?: string | null;
  /** Free-form conditions tag (e.g. 'dry', 'wet') used to bucket learned models. */
  conditions?: string | null;
  /** Green-flag, non-in/out lap usable for learning; defaults to true. */
  valid?: boolean;
}

/** A persisted `laps` row. */
export interface LapRecord {
  id: number;
  sessionId: number;
  lapNo: number;
  lapTimeS: number | null;
  sectorTimesS: number[] | null;
  fuelUsedL: number | null;
  fuelLeftL: number | null;
  avgTireTempC: number | null;
  tireWear01: number | null;
  compound: string | null;
  conditions: string | null;
  valid: boolean;
}

/** Composite key for a learned fuel model (one bucket per car/track/conditions). */
export interface FuelModelKey {
  car: string;
  track: string;
  conditions: string;
}

/** A persisted `fuel_models` row — the learning layer's per-bucket priors (docs/04, docs/05). */
export interface FuelModelRecord extends FuelModelKey {
  perLapLMean: number;
  perLapLStdev: number;
  samples: number;
  /** Epoch ms of the last update (priors get staler with age — docs/05 §8). */
  updatedAt: number;
}

/** Composite key for a learned tyre-degradation model (one bucket per car/track/compound). */
export interface TireModelKey {
  car: string;
  track: string;
  /** Tyre compound — degradation differs sharply by compound, so it buckets by it (docs/05 §2). */
  compound: string;
}

/**
 * A persisted `tire_models` row — learned degradation priors (docs/04, docs/05 §2). One learning
 * sample is a completed stint's fitted line: its slope (`degRatePerLapS`) and intercept (`baseLapS`),
 * folded into running stats so future sessions seed `fitTireDegradation` from history.
 */
export interface TireModelRecord extends TireModelKey {
  degRatePerLapSMean: number;
  degRatePerLapSStdev: number;
  baseLapSMean: number;
  baseLapSStdev: number;
  /** Stints folded in (degRate and baseLap advance together, so one count). */
  samples: number;
  /** Epoch ms of the last update (priors get staler with age — docs/05 §8). */
  updatedAt: number;
}
