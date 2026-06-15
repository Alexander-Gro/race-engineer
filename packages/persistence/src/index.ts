// @race-engineer/persistence
// Local-first SQLite store (better-sqlite3): session/lap history + the learned-priors
// layer that seeds the fuel model. No central server, no network — the user owns the file
// (CLAUDE.md rule 6). The LLM never touches this; strategy math consumes the priors it
// produces (docs/04 §Persistence, docs/05 §1 & §8).
export { openDatabase } from './db';
export type { Db, OpenOptions } from './db';
export { migrate, SCHEMA_VERSION } from './migrations';
export { SessionRepo } from './repos/sessions';
export { LapRepo } from './repos/laps';
export { FuelModelRepo } from './repos/fuel-models';
export { TireModelRepo } from './repos/tire-models';
export type { TireStintFit } from './repos/tire-models';
export {
  addSample,
  EMPTY_STATS,
  DEFAULT_MAX_PRIOR_WEIGHT,
  fuelPriorFromStats,
  fuelPriorFromRecord,
  statsFromRecord,
  EMPTY_TIRE_STATS,
  tirePriorFromStats,
  tirePriorFromRecord,
  tireStatsFromRecord,
} from './priors';
export type { RunningStats, TireRunningStats } from './priors';
export type {
  NewSession,
  SessionRecord,
  NewLap,
  LapRecord,
  FuelModelKey,
  FuelModelRecord,
  TireModelKey,
  TireModelRecord,
} from './types';
