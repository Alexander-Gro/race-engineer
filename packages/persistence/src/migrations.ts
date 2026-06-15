import type { Database } from 'better-sqlite3';

/**
 * Schema migrations for the local SQLite store. Idempotent (`IF NOT EXISTS`) and version-
 * gated via `PRAGMA user_version` so future tasks can add tables (events, transcripts,
 * setups — docs/04) without a destructive reset.
 *
 * v1 (T3.3): `sessions`, `laps`, `fuel_models`. v2 (T7.7): `tire_models` — the tyre-degradation
 * learning layer. Each version is additive; an existing v1 store upgrades in place on next open.
 */
export const SCHEMA_VERSION = 2;

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game        TEXT    NOT NULL,
  track       TEXT,
  car         TEXT,
  car_class   TEXT,
  type        TEXT,
  server      TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER
);

CREATE TABLE IF NOT EXISTS laps (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lap_no            INTEGER NOT NULL,
  lap_time_s        REAL,
  sector_times_json TEXT,
  fuel_used_l       REAL,
  fuel_left_l       REAL,
  avg_tire_temp_c   REAL,
  tire_wear01       REAL,
  compound          TEXT,
  conditions        TEXT,
  valid             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_laps_session ON laps (session_id, lap_no);

CREATE TABLE IF NOT EXISTS fuel_models (
  car             TEXT    NOT NULL,
  track           TEXT    NOT NULL,
  conditions      TEXT    NOT NULL,
  per_lap_l_mean  REAL    NOT NULL,
  per_lap_l_stdev REAL    NOT NULL,
  samples         INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (car, track, conditions)
);
`;

const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS tire_models (
  car                      TEXT    NOT NULL,
  track                    TEXT    NOT NULL,
  compound                 TEXT    NOT NULL,
  deg_rate_per_lap_s_mean  REAL    NOT NULL,
  deg_rate_per_lap_s_stdev REAL    NOT NULL,
  base_lap_s_mean          REAL    NOT NULL,
  base_lap_s_stdev         REAL    NOT NULL,
  samples                  INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  PRIMARY KEY (car, track, compound)
);
`;

/** Apply all pending migrations to bring `db` up to {@link SCHEMA_VERSION}. */
export const migrate = (db: Database): void => {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current < 1) {
    db.exec(MIGRATION_V1);
  }
  if (current < 2) {
    db.exec(MIGRATION_V2);
  }
  if (current !== SCHEMA_VERSION) {
    // PRAGMA doesn't accept bound params; SCHEMA_VERSION is a trusted integer literal.
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
};
