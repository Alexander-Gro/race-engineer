import { describe, expect, it } from 'vitest';
import { FuelPlanSchema } from '@race-engineer/core';
import {
  computeFuelPlan,
  estimatePerLapConsumption,
  fuelDeltasFromReadings,
  type FuelConsumption,
} from '../fuel';

const at = <T>(arr: readonly T[], i: number): T => {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
};

// A known consumption estimate, reused where we test the plan math directly.
const known = (perLapLiters: number): FuelConsumption => ({
  perLapLiters,
  confidence01: 0.8,
  sampleCount: 5,
});

describe('estimatePerLapConsumption', () => {
  it('uses a robust median that ignores a contaminated lap', () => {
    // 9.9 = a traffic/error lap; the median rejects it where a mean would not.
    const c = estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.7, 9.9, 2.5, 2.6] });
    expect(c.perLapLiters).toBeCloseTo(2.6);
    expect(c.sampleCount).toBe(5);
    expect(c.confidence01).toBeCloseTo(5 / (5 + 3)); // no prior -> default weight 3
  });

  it('blends with a learned prior; confidence comes from sample count', () => {
    const c = estimatePerLapConsumption({
      greenLapFuelDeltas: [3.0, 3.0, 3.0],
      prior: { meanLitersPerLap: 2.0, weight: 3 },
    });
    expect(c.perLapLiters).toBeCloseTo(2.5); // (3*2.0 + 3*3.0) / 6
    expect(c.confidence01).toBeCloseTo(0.5); // 3 / (3 + 3)
  });

  it('falls back to the prior mean with zero confidence before any laps', () => {
    const c = estimatePerLapConsumption({
      greenLapFuelDeltas: [],
      prior: { meanLitersPerLap: 2.8 },
    });
    expect(c.perLapLiters).toBeCloseTo(2.8);
    expect(c.confidence01).toBe(0);
    expect(c.sampleCount).toBe(0);
  });

  it('returns null per-lap with no data and no prior', () => {
    expect(estimatePerLapConsumption({ greenLapFuelDeltas: [] }).perLapLiters).toBeNull();
  });

  it('only uses the most recent `window` laps', () => {
    const c = estimatePerLapConsumption({
      greenLapFuelDeltas: [5, 5, 5, 2.6, 2.6, 2.6],
      window: 3,
    });
    expect(c.perLapLiters).toBeCloseTo(2.6);
    expect(c.sampleCount).toBe(3);
  });

  it('confidence rises with more samples', () => {
    const few = estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6] });
    const many = estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6, 2.6, 2.6] });
    expect(many.confidence01).toBeGreaterThan(few.confidence01);
  });

  it('a prior with weight 0 is ignored and yields full confidence', () => {
    const c = estimatePerLapConsumption({
      greenLapFuelDeltas: [2.6, 2.6, 2.6],
      prior: { meanLitersPerLap: 9.9, weight: 0 },
    });
    expect(c.perLapLiters).toBeCloseTo(2.6); // prior weight 0 -> samples only
    expect(c.confidence01).toBe(1); // 3 / (3 + 0)
  });

  it('uses all samples when the window exceeds the sample count', () => {
    const c = estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.7], window: 10 });
    expect(c.sampleCount).toBe(2);
    expect(c.perLapLiters).toBeCloseTo(2.65);
  });

  it('filters out non-finite and non-positive deltas', () => {
    const c = estimatePerLapConsumption({
      greenLapFuelDeltas: [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 2.6],
    });
    expect(c.sampleCount).toBe(1);
    expect(c.perLapLiters).toBeCloseTo(2.6);
  });
});

describe('fuelDeltasFromReadings', () => {
  it('derives per-lap deltas from boundary readings, excluding refuels', () => {
    const deltas = fuelDeltasFromReadings([50, 47.4, 44.8, 80, 77.3]);
    expect(deltas).toHaveLength(3); // the refuel jump (44.8 -> 80) is excluded
    expect(at(deltas, 0)).toBeCloseTo(2.6);
    expect(at(deltas, 2)).toBeCloseTo(2.7);
  });

  it('returns no deltas for empty or single-reading input', () => {
    expect(fuelDeltasFromReadings([])).toEqual([]);
    expect(fuelDeltasFromReadings([50])).toEqual([]);
  });
});

describe('computeFuelPlan', () => {
  it('doc-05 worked example: 38 L left, 2.6 L/lap, stop in 16 laps', () => {
    const plan = computeFuelPlan({
      fuelLiters: 38,
      consumption: known(2.6),
      lapsUntilPlannedStop: 16,
    });
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(Math.floor(plan.lapsRemainingOnFuel)).toBe(14); // 38 / 2.6 = 14.6
    expect(plan.fuelSaveTargetLitersPerLap ?? 0).toBeCloseTo(0.225, 3); // 2.6 - 38/16
  });

  it('computes fuel-to-finish for a timed race', () => {
    const plan = computeFuelPlan({
      fuelLiters: 30,
      consumption: known(2.6),
      race: { remainingS: 3600, avgGreenLapS: 120 }, // 30 laps
      reserveLiters: 2.6,
    });
    expect(plan?.lapsToFinish).toBe(30);
    expect(plan?.litersToFinish).toBeCloseTo(78); // 30 * 2.6
    expect(plan?.litersToAddNextStop).toBeCloseTo(78 - 30 + 2.6); // 50.6
  });

  it('adds a final lap when the leader starts one as the clock expires', () => {
    const plan = computeFuelPlan({
      fuelLiters: 30,
      consumption: known(2.6),
      race: { remainingS: 3600, avgGreenLapS: 120, addFinalLap: true },
    });
    expect(plan?.lapsToFinish).toBe(31);
  });

  it('emits no fuel-save target when there is comfortably enough fuel', () => {
    const plan = computeFuelPlan({
      fuelLiters: 50,
      consumption: known(2.6),
      lapsUntilPlannedStop: 5, // 50/2.6 = 19 laps >> 5
    });
    expect(plan?.fuelSaveTargetLitersPerLap).toBeNull();
  });

  it('returns null when per-lap consumption is unknown', () => {
    expect(
      computeFuelPlan({
        fuelLiters: 50,
        consumption: { perLapLiters: null, confidence01: 0, sampleCount: 0 },
      }),
    ).toBeNull();
  });

  it('leaves fuel-to-finish null for a lap-count race (no timed pace given)', () => {
    const plan = computeFuelPlan({ fuelLiters: 50, consumption: known(2.6) });
    expect(plan).not.toBeNull();
    expect(plan?.lapsToFinish).toBeNull();
    expect(plan?.litersToFinish).toBeNull();
    expect(plan?.litersToAddNextStop).toBeNull();
  });

  it('defaults the reserve to ~one lap of fuel when not given', () => {
    const plan = computeFuelPlan({
      fuelLiters: 30,
      consumption: known(2.6),
      race: { remainingS: 3600, avgGreenLapS: 120 }, // 30 laps -> 78 L to finish
    });
    // reserve defaults to perLap (2.6): max(0, 78 - 30 + 2.6)
    expect(plan?.litersToAddNextStop).toBeCloseTo(78 - 30 + 2.6);
  });

  it('skips the fuel-save target when lapsUntilPlannedStop is not positive', () => {
    const plan = computeFuelPlan({
      fuelLiters: 10,
      consumption: known(2.6),
      lapsUntilPlannedStop: 0,
    });
    expect(plan?.fuelSaveTargetLitersPerLap).toBeNull();
  });
});

describe('properties (docs/05 §Testing)', () => {
  it('more fuel never yields fewer laps remaining (monotonic)', () => {
    let prev = -Infinity;
    for (const fuelLiters of [0, 5, 10, 20, 40, 80]) {
      const plan = computeFuelPlan({ fuelLiters, consumption: known(2.6) });
      const laps = plan?.lapsRemainingOnFuel ?? 0;
      expect(laps).toBeGreaterThanOrEqual(prev);
      prev = laps;
    }
  });

  it('all outputs are finite and confidence stays within [0, 1]', () => {
    for (const fuelLiters of [0, 1, 13.3, 50, 117]) {
      for (const ppl of [1.5, 2.6, 4.0]) {
        const plan = computeFuelPlan({
          fuelLiters,
          consumption: { perLapLiters: ppl, confidence01: 0.5, sampleCount: 4 },
          race: { remainingS: 5400, avgGreenLapS: 95 },
          lapsUntilPlannedStop: 12,
        });
        expect(plan).not.toBeNull();
        if (!plan) continue;
        const numbers = [
          plan.perLapLiters,
          plan.lapsRemainingOnFuel,
          plan.lapsToFinish,
          plan.litersToFinish,
          plan.litersToAddNextStop,
          plan.fuelSaveTargetLitersPerLap,
          plan.confidence01,
        ];
        for (const v of numbers) {
          if (v !== null) expect(Number.isFinite(v)).toBe(true);
        }
        expect(plan.confidence01).toBeGreaterThanOrEqual(0);
        expect(plan.confidence01).toBeLessThanOrEqual(1);
      }
    }
  });

  it('produces FuelPlan objects that satisfy the canonical schema', () => {
    const plan = computeFuelPlan({
      fuelLiters: 40,
      consumption: known(2.6),
      race: { remainingS: 3600, avgGreenLapS: 110 },
      lapsUntilPlannedStop: 20,
    });
    expect(FuelPlanSchema.safeParse(plan).success).toBe(true);
  });
});
