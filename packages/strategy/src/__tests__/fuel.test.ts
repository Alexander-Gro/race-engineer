import { describe, expect, it } from 'vitest';
import { FuelPlanSchema } from '@race-engineer/core';
import {
  computeFuelPlan,
  energyDeltasFromReadings01,
  estimatePerLapConsumption,
  estimatePerLapEnergy,
  fuelDeltasFromReadings,
  type EnergyConsumption,
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

// A known Virtual-Energy burn estimate (0..1 of the budget / lap).
const knownEnergy = (perLap01: number): EnergyConsumption => ({
  perLap01,
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

describe('estimatePerLapEnergy', () => {
  it('uses the same robust estimator as fuel, over the 0..1 VE budget', () => {
    // 0.30 = a contaminated lap; the median rejects it.
    const c = estimatePerLapEnergy({ greenLapEnergyDeltas01: [0.05, 0.051, 0.3, 0.049, 0.05] });
    expect(c.perLap01).toBeCloseTo(0.05);
    expect(c.sampleCount).toBe(5);
    expect(c.confidence01).toBeCloseTo(5 / (5 + 3));
  });

  it('blends with a learned prior and falls back to it before any laps', () => {
    expect(
      estimatePerLapEnergy({
        greenLapEnergyDeltas01: [0.06, 0.06, 0.06],
        prior: { meanPerLap01: 0.04, weight: 3 },
      }).perLap01,
    ).toBeCloseTo(0.05); // (3*0.04 + 3*0.06) / 6
    const cold = estimatePerLapEnergy({
      greenLapEnergyDeltas01: [],
      prior: { meanPerLap01: 0.045 },
    });
    expect(cold.perLap01).toBeCloseTo(0.045);
    expect(cold.confidence01).toBe(0);
  });

  it('returns null per-lap with no data and no prior (never guesses VE)', () => {
    expect(estimatePerLapEnergy({ greenLapEnergyDeltas01: [] }).perLap01).toBeNull();
  });
});

describe('energyDeltasFromReadings01', () => {
  it('derives per-lap VE deltas, excluding the refill jump at a stop', () => {
    const deltas = energyDeltasFromReadings01([1.0, 0.95, 0.9, 1.0, 0.95]);
    expect(deltas).toHaveLength(3); // the refill (0.9 -> 1.0) is excluded
    expect(at(deltas, 0)).toBeCloseTo(0.05);
  });
});

describe('computeFuelPlan — Virtual Energy binding constraint (docs/05 §VE)', () => {
  it('leaves all VE fields null and bindingConstraint null when VE is not supplied', () => {
    const plan = computeFuelPlan({ fuelLiters: 40, consumption: known(2.6) });
    expect(plan?.perLapEnergy01).toBeNull();
    expect(plan?.lapsRemainingOnEnergy).toBeNull();
    expect(plan?.energyToFinish01).toBeNull();
    expect(plan?.energyToAddNextStop01).toBeNull();
    expect(plan?.energySaveTargetPerLap01).toBeNull();
    expect(plan?.bindingConstraint).toBeNull();
  });

  it('fuel binds when fuel runs out before VE', () => {
    const plan = computeFuelPlan({
      fuelLiters: 30, // 30 / 2.6 = 11.5 laps on fuel
      consumption: known(2.6),
      energy: { level01: 0.9, consumption: knownEnergy(0.05) }, // 0.9 / 0.05 = 18 laps on VE
    });
    expect(plan?.lapsRemainingOnFuel).toBeCloseTo(11.54, 2);
    expect(plan?.lapsRemainingOnEnergy).toBeCloseTo(18);
    expect(plan?.bindingConstraint).toBe('fuel');
  });

  it('VE binds when energy runs out before fuel — the LMU case the user flagged', () => {
    const plan = computeFuelPlan({
      fuelLiters: 60, // 60 / 2.6 = 23 laps on fuel
      consumption: known(2.6),
      energy: { level01: 0.5, consumption: knownEnergy(0.05) }, // 0.5 / 0.05 = 10 laps on VE
    });
    expect(plan?.lapsRemainingOnEnergy).toBeCloseTo(10);
    expect(plan?.bindingConstraint).toBe('energy');
  });

  it('computes VE-to-finish and VE-to-add at the next stop for a timed race', () => {
    const plan = computeFuelPlan({
      fuelLiters: 60,
      consumption: known(2.6),
      race: { remainingS: 3600, avgGreenLapS: 120 }, // 30 laps
      energy: { level01: 0.5, consumption: knownEnergy(0.04), reserve01: 0.04 },
    });
    expect(plan?.energyToFinish01).toBeCloseTo(1.2); // 30 * 0.04
    expect(plan?.energyToAddNextStop01).toBeCloseTo(1.2 - 0.5 + 0.04); // 0.74
  });

  it('emits a VE-save target when energy would run out before the planned stop', () => {
    const plan = computeFuelPlan({
      fuelLiters: 80, // plenty of fuel, so VE is the bind
      consumption: known(2.6),
      lapsUntilPlannedStop: 12,
      energy: { level01: 0.5, consumption: knownEnergy(0.06) }, // 0.5/0.06 = 8.3 laps < 12
    });
    // need 0.5/12 = 0.04167 per lap; save = 0.06 - 0.04167
    expect(plan?.energySaveTargetPerLap01 ?? 0).toBeCloseTo(0.06 - 0.5 / 12, 4);
  });

  it('leaves VE fields null when VE level is known but its per-lap burn is not', () => {
    const plan = computeFuelPlan({
      fuelLiters: 60,
      consumption: known(2.6),
      energy: { level01: 0.7, consumption: { perLap01: null, confidence01: 0, sampleCount: 0 } },
    });
    expect(plan?.perLapEnergy01).toBeNull();
    expect(plan?.lapsRemainingOnEnergy).toBeNull();
    expect(plan?.bindingConstraint).toBeNull(); // can't bind on an unknown rate
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

  it('all outputs are finite and confidence stays within [0, 1] (incl. Virtual Energy)', () => {
    for (const fuelLiters of [0, 1, 13.3, 50, 117]) {
      for (const ppl of [1.5, 2.6, 4.0]) {
        for (const level01 of [0, 0.35, 1]) {
          const plan = computeFuelPlan({
            fuelLiters,
            consumption: { perLapLiters: ppl, confidence01: 0.5, sampleCount: 4 },
            race: { remainingS: 5400, avgGreenLapS: 95 },
            lapsUntilPlannedStop: 12,
            energy: { level01, consumption: knownEnergy(0.045) },
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
            plan.perLapEnergy01,
            plan.lapsRemainingOnEnergy,
            plan.energyToFinish01,
            plan.energyToAddNextStop01,
            plan.energySaveTargetPerLap01,
            plan.confidence01,
          ];
          for (const v of numbers) {
            if (v !== null) expect(Number.isFinite(v)).toBe(true);
          }
          expect(plan.confidence01).toBeGreaterThanOrEqual(0);
          expect(plan.confidence01).toBeLessThanOrEqual(1);
          expect(['fuel', 'energy']).toContain(plan.bindingConstraint);
        }
      }
    }
  });

  it('more Virtual Energy never yields fewer VE laps remaining (monotonic)', () => {
    let prev = -Infinity;
    for (const level01 of [0, 0.1, 0.3, 0.6, 1]) {
      const plan = computeFuelPlan({
        fuelLiters: 60,
        consumption: known(2.6),
        energy: { level01, consumption: knownEnergy(0.05) },
      });
      const laps = plan?.lapsRemainingOnEnergy ?? 0;
      expect(laps).toBeGreaterThanOrEqual(prev);
      prev = laps;
    }
  });

  it('produces FuelPlan objects that satisfy the canonical schema (with and without VE)', () => {
    const fuelOnly = computeFuelPlan({
      fuelLiters: 40,
      consumption: known(2.6),
      race: { remainingS: 3600, avgGreenLapS: 110 },
      lapsUntilPlannedStop: 20,
    });
    expect(FuelPlanSchema.safeParse(fuelOnly).success).toBe(true);
    const withVe = computeFuelPlan({
      fuelLiters: 40,
      consumption: known(2.6),
      race: { remainingS: 3600, avgGreenLapS: 110 },
      lapsUntilPlannedStop: 20,
      energy: { level01: 0.6, consumption: knownEnergy(0.05) },
    });
    expect(FuelPlanSchema.safeParse(withVe).success).toBe(true);
  });
});
