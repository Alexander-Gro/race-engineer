import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { openDatabase } from '../db';
import { FuelModelRepo } from '../repos/fuel-models';
import type { FuelModelKey } from '../types';

const KEY: FuelModelKey = { car: 'Hypercar 01', track: 'Le Mans', conditions: 'dry' };

describe('FuelModelRepo (learning layer)', () => {
  let db: Db;
  let models: FuelModelRepo;

  beforeEach(() => {
    db = openDatabase(); // :memory:
    models = new FuelModelRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('has nothing learned for an unseen bucket', () => {
    expect(models.get(KEY)).toBeNull();
    expect(models.getPrior(KEY)).toBeNull();
  });

  it('accumulates a running mean/stdev matching the batch formula', () => {
    // Samples 2.4, 2.5, 2.6 → mean 2.5, sample-stdev 0.1 (hand-computed).
    models.record(KEY, 2.4, 100);
    models.record(KEY, 2.5, 200);
    const r = models.record(KEY, 2.6, 300);

    expect(r.samples).toBe(3);
    expect(r.perLapLMean).toBeCloseTo(2.5, 10);
    expect(r.perLapLStdev).toBeCloseTo(0.1, 10);
    expect(r.updatedAt).toBe(300);

    // Persisted, not just returned.
    expect(models.get(KEY)).toEqual(r);
  });

  it('first sample sets the mean with zero spread', () => {
    const r = models.record(KEY, 2.73, 1);
    expect(r).toMatchObject({ samples: 1, perLapLMean: 2.73, perLapLStdev: 0 });
  });

  it('accumulates across sessions (the bucket key omits session id)', () => {
    // Simulate three separate sessions all on the same car/track/conditions.
    models.record(KEY, 3.0, 10); // session A
    models.record(KEY, 3.0, 20); // session B
    const r = models.record(KEY, 3.0, 30); // session C
    expect(r.samples).toBe(3);
    expect(r.perLapLMean).toBeCloseTo(3.0, 10);
    expect(r.perLapLStdev).toBeCloseTo(0, 10);
  });

  it('keeps separate buckets per car/track/conditions', () => {
    models.record(KEY, 2.5, 1);
    models.record({ ...KEY, conditions: 'wet' }, 3.4, 1);
    expect(models.get(KEY)?.perLapLMean).toBeCloseTo(2.5, 10);
    expect(models.get({ ...KEY, conditions: 'wet' })?.perLapLMean).toBeCloseTo(3.4, 10);
  });

  it('derives a prior whose weight grows with samples and saturates at the cap', () => {
    models.record(KEY, 2.5, 1);
    expect(models.getPrior(KEY)).toMatchObject({ meanLitersPerLap: 2.5, weight: 1 });

    for (let i = 0; i < 9; i += 1) models.record(KEY, 2.5, 2 + i);
    // 10 samples, default cap 5 → weight saturates.
    expect(models.getPrior(KEY)?.weight).toBe(5);
    expect(models.getPrior(KEY, 3)?.weight).toBe(3); // honors a custom cap
  });

  it('persists models to disk across a reopen and re-migrates idempotently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'race-eng-persist-'));
    const file = join(dir, 'store.sqlite');
    try {
      const a = openDatabase(file);
      new FuelModelRepo(a).record(KEY, 2.55, 42);
      a.close();

      // Reopen: migrate() runs again (must not throw), data survives.
      const b = openDatabase(file);
      const reread = new FuelModelRepo(b).get(KEY);
      b.close();

      expect(reread).toMatchObject({ perLapLMean: 2.55, samples: 1, updatedAt: 42 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
