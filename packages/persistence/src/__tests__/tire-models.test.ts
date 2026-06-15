import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fitTireDegradation } from '@race-engineer/strategy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { openDatabase } from '../db';
import { TireModelRepo } from '../repos/tire-models';
import type { TireModelKey } from '../types';

const KEY: TireModelKey = { car: 'Hypercar 01', track: 'Le Mans', compound: 'medium' };

describe('TireModelRepo (tyre learning layer)', () => {
  let db: Db;
  let models: TireModelRepo;

  beforeEach(() => {
    db = openDatabase(); // :memory:
    models = new TireModelRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('has nothing learned for an unseen bucket', () => {
    expect(models.get(KEY)).toBeNull();
    expect(models.getPrior(KEY)).toBeNull();
  });

  it('accumulates running mean/stdev for both the slope and the intercept', () => {
    // degRate 0.04, 0.05, 0.06 → mean 0.05, stdev 0.01; base 100, 101, 102 → mean 101, stdev 1.
    models.record(KEY, { degRatePerLapS: 0.04, baseLapS: 100 }, 100);
    models.record(KEY, { degRatePerLapS: 0.05, baseLapS: 101 }, 200);
    const r = models.record(KEY, { degRatePerLapS: 0.06, baseLapS: 102 }, 300);

    expect(r.samples).toBe(3);
    expect(r.degRatePerLapSMean).toBeCloseTo(0.05, 10);
    expect(r.degRatePerLapSStdev).toBeCloseTo(0.01, 10);
    expect(r.baseLapSMean).toBeCloseTo(101, 10);
    expect(r.baseLapSStdev).toBeCloseTo(1, 10);
    expect(r.updatedAt).toBe(300);

    expect(models.get(KEY)).toEqual(r); // persisted, not just returned
  });

  it('first stint sets the means with zero spread', () => {
    const r = models.record(KEY, { degRatePerLapS: 0.07, baseLapS: 99.5 }, 1);
    expect(r).toMatchObject({
      samples: 1,
      degRatePerLapSMean: 0.07,
      degRatePerLapSStdev: 0,
      baseLapSMean: 99.5,
      baseLapSStdev: 0,
    });
  });

  it('keeps separate buckets per compound', () => {
    models.record(KEY, { degRatePerLapS: 0.05, baseLapS: 101 }, 1);
    models.record({ ...KEY, compound: 'soft' }, { degRatePerLapS: 0.09, baseLapS: 100 }, 1);
    expect(models.get(KEY)?.degRatePerLapSMean).toBeCloseTo(0.05, 10);
    expect(models.get({ ...KEY, compound: 'soft' })?.degRatePerLapSMean).toBeCloseTo(0.09, 10);
  });

  it('derives a prior whose weight grows with samples and saturates at the cap', () => {
    models.record(KEY, { degRatePerLapS: 0.05, baseLapS: 101 }, 1);
    expect(models.getPrior(KEY)).toMatchObject({
      degRatePerLapS: 0.05,
      baseLapS: 101,
      weight: 1,
    });

    for (let i = 0; i < 9; i += 1)
      models.record(KEY, { degRatePerLapS: 0.05, baseLapS: 101 }, 2 + i);
    expect(models.getPrior(KEY)?.weight).toBe(5); // 10 samples, default cap 5
    expect(models.getPrior(KEY, 3)?.weight).toBe(3); // honors a custom cap
  });

  it('feeds fitTireDegradation: a learned prior with no live laps yields the prior pace at conf 0', () => {
    models.record(KEY, { degRatePerLapS: 0.05, baseLapS: 101 }, 1);
    const prior = models.getPrior(KEY);
    const deg = fitTireDegradation({ greenStintLaps: [], prior });
    expect(deg.degRatePerLapS).toBeCloseTo(0.05, 10);
    expect(deg.baseLapS).toBeCloseTo(101, 10);
    expect(deg.confidence01).toBe(0); // prior seeds the value but the engineer hedges until live laps
  });

  it('persists models to disk across a reopen and re-migrates idempotently (v2 upgrade path)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'race-eng-tire-'));
    const file = join(dir, 'store.sqlite');
    try {
      const a = openDatabase(file);
      new TireModelRepo(a).record(KEY, { degRatePerLapS: 0.055, baseLapS: 100.5 }, 42);
      a.close();

      const b = openDatabase(file); // migrate() runs again (must not throw); data survives
      const reread = new TireModelRepo(b).get(KEY);
      b.close();

      expect(reread).toMatchObject({
        degRatePerLapSMean: 0.055,
        baseLapSMean: 100.5,
        samples: 1,
        updatedAt: 42,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
