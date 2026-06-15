import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import { SCHEMA_VERSION } from '../migrations';
import { FuelModelRepo } from '../repos/fuel-models';
import { TireModelRepo } from '../repos/tire-models';
import type { FuelModelKey, TireModelKey } from '../types';

const FUEL: FuelModelKey = { car: 'Hypercar 01', track: 'Le Mans', conditions: 'dry' };
const TIRE: TireModelKey = { car: 'Hypercar 01', track: 'Le Mans', compound: 'medium' };

describe('schema migrations', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'race-eng-migrate-'));
    file = join(dir, 'store.sqlite');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('upgrades an existing v1 store to v2 without losing v1 data (additive)', () => {
    // Hand-build a v1-only store (as an older app version would have left it): fuel_models + a row.
    const v1 = new Database(file);
    v1.exec(`
      CREATE TABLE fuel_models (
        car TEXT NOT NULL, track TEXT NOT NULL, conditions TEXT NOT NULL,
        per_lap_l_mean REAL NOT NULL, per_lap_l_stdev REAL NOT NULL,
        samples INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (car, track, conditions)
      );
    `);
    v1.prepare(`INSERT INTO fuel_models VALUES (@car, @track, @conditions, 2.6, 0, 4, 7)`).run(
      FUEL,
    );
    v1.pragma('user_version = 1');
    v1.close();

    // Reopen with current code → migrate() applies only V2 (current=1), preserving the fuel row.
    const db = openDatabase(file);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      // v1 data survived.
      expect(new FuelModelRepo(db).get(FUEL)).toMatchObject({ perLapLMean: 2.6, samples: 4 });
      // The new v2 table exists and is usable.
      const rec = new TireModelRepo(db).record(TIRE, { degRatePerLapS: 0.05, baseLapS: 101 }, 9);
      expect(rec.samples).toBe(1);
    } finally {
      db.close();
    }
  });

  it('a fresh store opens at the current version with both tables present', () => {
    const db = openDatabase(file);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      expect(new FuelModelRepo(db).get(FUEL)).toBeNull(); // empty but queryable
      expect(new TireModelRepo(db).get(TIRE)).toBeNull();
    } finally {
      db.close();
    }
  });
});
