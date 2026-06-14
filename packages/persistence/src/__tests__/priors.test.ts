import { estimatePerLapConsumption } from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import {
  addSample,
  DEFAULT_MAX_PRIOR_WEIGHT,
  EMPTY_STATS,
  fuelPriorFromStats,
  type RunningStats,
} from '../priors';

/** Fold N copies of `x` into running stats (a learned model that has seen N laps at `x`). */
const learn = (x: number, n: number): RunningStats => {
  let s = EMPTY_STATS;
  for (let i = 0; i < n; i += 1) s = addSample(s, x);
  return s;
};

describe('fuelPriorFromStats', () => {
  it('returns null until something is learned', () => {
    expect(fuelPriorFromStats(EMPTY_STATS)).toBeNull();
    expect(fuelPriorFromStats({ mean: 0, stdev: 0, samples: 4 })).toBeNull(); // mean not > 0
  });

  it('weight is monotonic non-decreasing in sample count and capped', () => {
    let prev = 0;
    for (let n = 1; n <= 12; n += 1) {
      const w = fuelPriorFromStats(learn(2.5, n))?.weight ?? 0;
      expect(w).toBeGreaterThanOrEqual(prev);
      expect(w).toBeLessThanOrEqual(DEFAULT_MAX_PRIOR_WEIGHT);
      prev = w;
    }
    expect(prev).toBe(DEFAULT_MAX_PRIOR_WEIGHT); // saturates
  });
});

describe('learned priors shift the blended fuel estimate (docs/05 §1)', () => {
  const LEARNED = 2.5; // model has learned 2.5 L/lap
  const liveLaps = [3.0, 3.0]; // two live green laps burning 3.0

  it('a stronger (more-sampled) prior pulls the estimate toward the learned mean', () => {
    const weakPrior = fuelPriorFromStats(learn(LEARNED, 1)); // weight 1
    const strongPrior = fuelPriorFromStats(learn(LEARNED, 20)); // weight 5 (capped)

    const weak = estimatePerLapConsumption({ greenLapFuelDeltas: liveLaps, prior: weakPrior });
    const strong = estimatePerLapConsumption({ greenLapFuelDeltas: liveLaps, prior: strongPrior });

    // Both blends sit between the learned 2.5 and the live 3.0...
    expect(weak.perLapLiters).toBeGreaterThan(LEARNED);
    expect(strong.perLapLiters).toBeGreaterThan(LEARNED);
    // ...but the stronger prior pulls harder toward 2.5.
    expect(strong.perLapLiters!).toBeLessThan(weak.perLapLiters!);

    // Worked numbers: weight 1 → (1·2.5 + 2·3.0)/3 = 2.8333; weight 5 → (5·2.5 + 2·3.0)/7 = 2.6429.
    expect(weak.perLapLiters!).toBeCloseTo(2.8333, 3);
    expect(strong.perLapLiters!).toBeCloseTo(2.6429, 3);
  });

  it('seeds a usable estimate from the prior before any live lap (confidence 0)', () => {
    const prior = fuelPriorFromStats(learn(LEARNED, 8));
    const seeded = estimatePerLapConsumption({ greenLapFuelDeltas: [], prior });
    expect(seeded.perLapLiters).toBe(LEARNED); // pure prior
    expect(seeded.confidence01).toBe(0); // no live data yet — engineer hedges
    expect(seeded.sampleCount).toBe(0);
  });

  it('live confidence rises as live laps accumulate against a fixed prior', () => {
    const prior = fuelPriorFromStats(learn(LEARNED, 20)); // weight 5
    const c1 = estimatePerLapConsumption({ greenLapFuelDeltas: [3.0], prior }).confidence01;
    const c3 = estimatePerLapConsumption({
      greenLapFuelDeltas: [3.0, 3.0, 3.0],
      prior,
    }).confidence01;
    expect(c3).toBeGreaterThan(c1);
    // confidence = n/(n+weight): 1/6 then 3/8.
    expect(c1).toBeCloseTo(1 / 6, 6);
    expect(c3).toBeCloseTo(3 / 8, 6);
  });
});

describe('properties: no NaN/Infinity, confidence in [0,1]', () => {
  it('holds across a sweep of learned/live combinations', () => {
    for (let learned = 1; learned <= 5; learned += 1) {
      for (let nLearned = 0; nLearned <= 30; nLearned += 1) {
        const prior = nLearned === 0 ? null : fuelPriorFromStats(learn(learned, nLearned));
        for (let nLive = 0; nLive <= 6; nLive += 1) {
          const live = Array.from({ length: nLive }, () => learned + 0.3);
          const est = estimatePerLapConsumption({ greenLapFuelDeltas: live, prior });
          expect(est.confidence01).toBeGreaterThanOrEqual(0);
          expect(est.confidence01).toBeLessThanOrEqual(1);
          if (est.perLapLiters !== null) {
            expect(Number.isFinite(est.perLapLiters)).toBe(true);
            expect(est.perLapLiters).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('addSample never produces NaN/negative stdev', () => {
    let s = EMPTY_STATS;
    for (const x of [2.4, 9.9, 0.1, 2.5, 100, 2.6]) {
      s = addSample(s, x);
      expect(Number.isFinite(s.mean)).toBe(true);
      expect(Number.isFinite(s.stdev)).toBe(true);
      expect(s.stdev).toBeGreaterThanOrEqual(0);
    }
  });
});
