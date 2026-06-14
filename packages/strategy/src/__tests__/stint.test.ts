import { StintPlanSchema, type StintPlan } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import {
  distributeLaps,
  maxStintLapsByFuel,
  optimizeStintCount,
  planStints,
  type StintPlannerInput,
} from '../stint';
import type { TireDegradation } from '../tires';

const totalLaps = (plan: StintPlan): number =>
  plan.stints.reduce((acc, s) => acc + (s.endLap - s.startLap), 0);

describe('maxStintLapsByFuel', () => {
  it('is floor((tank − reserve) / perLap) (worked example: (60−2.6)/2.6 → 22)', () => {
    expect(maxStintLapsByFuel(60, 2.6, 2.6)).toBe(22);
    expect(maxStintLapsByFuel(100, 2.0, 2.0)).toBe(49);
  });

  it('is 0 when the tank cannot cover even one lap plus reserve, or perLap is unusable', () => {
    expect(maxStintLapsByFuel(3, 2.6, 2.6)).toBe(0);
    expect(maxStintLapsByFuel(60, 0, 2.6)).toBe(0);
  });
});

describe('distributeLaps', () => {
  it('splits evenly, remainder onto the earliest stints', () => {
    expect(distributeLaps(30, 2)).toEqual([15, 15]);
    expect(distributeLaps(40, 3)).toEqual([14, 13, 13]);
    expect(distributeLaps(20, 3)).toEqual([7, 7, 6]);
    expect(distributeLaps(40, 4)).toEqual([10, 10, 10, 10]);
  });

  it('always sums back to the total', () => {
    for (const [total, n] of [
      [37, 4],
      [101, 7],
      [5, 5],
      [13, 1],
    ] as const) {
      expect(distributeLaps(total, n).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('planStints — fuel-bound, no trade-off inputs', () => {
  // 30 laps, 60 L tank, 2.6 L/lap, 1-lap reserve → maxStint 22 → 2 stints, 1 stop.
  const plan = planStints({
    raceLaps: 30,
    tankCapacityLiters: 60,
    perLapFuelLiters: 2.6,
  })!;

  it('takes the fewest stints that cover the race on fuel (worked example: 2 × 15)', () => {
    expect(plan.stints.map((s) => [s.startLap, s.endLap])).toEqual([
      [0, 15],
      [15, 30],
    ]);
    expect(totalLaps(plan)).toBe(30);
  });

  it('recommends a starting fill (laps·perLap + reserve) then per-stint top-ups', () => {
    expect(plan.stints[0]!.fuelAddLiters).toBeCloseTo(15 * 2.6 + 2.6, 6); // 41.6 starting fill
    expect(plan.stints[1]!.fuelAddLiters).toBeCloseTo(15 * 2.6, 6); // 39 L top-up
  });

  it('emits one fuel-limited pit window per stop, nominal stop inside [earliest, latest]', () => {
    expect(plan.pitWindows).toHaveLength(1);
    const w = plan.pitWindows[0]!;
    expect(w).toEqual({ earliestLap: 8, latestLap: 22, reason: 'fuel-limited' });
    expect(w.earliestLap).toBeLessThanOrEqual(15); // nominal stop
    expect(15).toBeLessThanOrEqual(w.latestLap);
  });

  it('is schema-valid and reports no mandatory stops requirement', () => {
    expect(() => StintPlanSchema.parse(plan)).not.toThrow();
    expect(plan.mandatoryStopsRemaining).toBeNull();
  });
});

describe('planStints — tyre-bound', () => {
  // 40 laps, big tank (fuel maxStint 49) but tyres only last 12 laps → 4 stints.
  const plan = planStints({
    raceLaps: 40,
    tankCapacityLiters: 100,
    perLapFuelLiters: 2.0,
    maxStintLapsByTire: 12,
    tireCompound: 'medium',
  })!;

  it('lets tyre life bound the stint length (4 × 10)', () => {
    expect(plan.stints).toHaveLength(4);
    expect(plan.stints.every((s) => s.endLap - s.startLap === 10)).toBe(true);
    expect(plan.pitWindows.every((w) => w.reason === 'tyre-limited')).toBe(true);
  });

  it('reports expected tyre degradation as stint length / tyre life, and the compound', () => {
    expect(plan.stints[0]!.expectedDegradation01).toBeCloseTo(10 / 12, 6);
    expect(plan.stints.every((s) => s.tireCompound === 'medium')).toBe(true);
    expect(() => StintPlanSchema.parse(plan)).not.toThrow();
  });
});

describe('planStints / optimizeStintCount — fewer-vs-more-stops trade-off (docs/05 §4)', () => {
  const deg: TireDegradation = {
    degRatePerLapS: 0.25,
    baseLapS: 100,
    confidence01: 0.8,
    sampleCount: 8,
  };
  // 40 laps, fuel maxStint 20 → min 2 stints. With deg 0.25 s/lap and a 25 s pit-loss, one extra
  // stop saves more deg than it costs: cost(2)=130, cost(3)=121.75, cost(4)=130, cost(5)=145.
  const base: StintPlannerInput = {
    raceLaps: 40,
    tankCapacityLiters: 42,
    perLapFuelLiters: 2.0,
    deg,
    pitLossS: 25,
  };

  it('picks the 3-stint plan when the extra stop is net faster', () => {
    const choice = optimizeStintCount(base)!;
    expect(choice.numStints).toBe(3);
    expect(choice.sizes).toEqual([14, 13, 13]);
    expect(choice.totalComparableS).toBeCloseTo(121.75, 6);
  });

  it('the 2-stint and 4-stint alternatives are both slower than the chosen 3-stint plan', () => {
    const cost = (maxExtraStops: number, force?: Partial<StintPlannerInput>) =>
      optimizeStintCount({ ...base, ...force, maxExtraStops })!.totalComparableS;
    // Capping extra stops at 0 forces the 2-stint baseline; it is slower than 121.75.
    expect(cost(0)).toBeCloseTo(130, 6);
  });

  it('prefers fewer stops when the trade-off is unquantified (no pit-loss → 2 stints)', () => {
    expect(optimizeStintCount({ ...base, pitLossS: null })!.numStints).toBe(2);
  });

  it('ignores the trade-off when tyre-deg confidence is below the floor', () => {
    const shaky = { ...deg, confidence01: 0.1 };
    expect(optimizeStintCount({ ...base, deg: shaky })!.numStints).toBe(2);
  });
});

describe('planStints — mandatory stops', () => {
  // 20 laps easily done in one tank, but the rules require 2 stops → 3 stints.
  const plan = planStints({
    raceLaps: 20,
    tankCapacityLiters: 60,
    perLapFuelLiters: 2.0,
    mandatoryStops: 2,
  })!;

  it('forces at least mandatoryStops + 1 stints and reports the requirement', () => {
    expect(plan.stints).toHaveLength(3);
    expect(plan.stints.map((s) => s.endLap - s.startLap)).toEqual([7, 7, 6]);
    expect(plan.pitWindows).toHaveLength(2);
    expect(plan.mandatoryStopsRemaining).toBe(2);
  });

  it('labels windows as mandatory-driven when the rules add stops beyond the fuel minimum', () => {
    expect(plan.pitWindows.every((w) => w.reason.includes('mandatory stop'))).toBe(true);
  });
});

describe('planStints — silent when not plannable', () => {
  it('returns null with no fuel rate, no laps, or a tank too small for one lap', () => {
    expect(planStints({ raceLaps: 30, tankCapacityLiters: 60, perLapFuelLiters: 0 })).toBeNull();
    expect(planStints({ raceLaps: 0, tankCapacityLiters: 60, perLapFuelLiters: 2.6 })).toBeNull();
    expect(planStints({ raceLaps: 30, tankCapacityLiters: 3, perLapFuelLiters: 2.6 })).toBeNull();
    expect(
      optimizeStintCount({ raceLaps: 30, tankCapacityLiters: 3, perLapFuelLiters: 2.6 }),
    ).toBeNull();
  });
});

describe('properties', () => {
  it('more tank capacity never increases the stint count; output is always schema-valid', () => {
    const stintsFor = (tank: number) =>
      planStints({ raceLaps: 50, tankCapacityLiters: tank, perLapFuelLiters: 3.0 })!.stints.length;
    let prev = Infinity;
    for (const tank of [40, 60, 90, 120, 200]) {
      const n = stintsFor(tank);
      expect(n).toBeLessThanOrEqual(prev);
      prev = n;
    }
  });

  it('stints are contiguous, cover exactly the race, and every field is finite/in-range', () => {
    const cases: StintPlannerInput[] = [
      { raceLaps: 37, tankCapacityLiters: 70, perLapFuelLiters: 2.4 },
      { raceLaps: 60, tankCapacityLiters: 80, perLapFuelLiters: 2.0, maxStintLapsByTire: 14 },
      {
        raceLaps: 25,
        tankCapacityLiters: 50,
        perLapFuelLiters: 3.1,
        mandatoryStops: 1,
        startLap: 5,
      },
    ];
    for (const input of cases) {
      const plan = planStints(input)!;
      expect(() => StintPlanSchema.parse(plan)).not.toThrow();
      const start = input.startLap ?? 0;
      expect(plan.stints[0]!.startLap).toBe(start);
      expect(plan.stints[plan.stints.length - 1]!.endLap).toBe(start + Math.floor(input.raceLaps));
      for (let i = 1; i < plan.stints.length; i += 1) {
        expect(plan.stints[i]!.startLap).toBe(plan.stints[i - 1]!.endLap); // contiguous
      }
      expect(plan.pitWindows).toHaveLength(plan.stints.length - 1);
      for (const s of plan.stints) {
        expect(s.endLap - s.startLap).toBeGreaterThanOrEqual(1);
        expect(Number.isFinite(s.fuelAddLiters)).toBe(true);
        expect(s.expectedDegradation01).toBeGreaterThanOrEqual(0);
        expect(s.expectedDegradation01).toBeLessThanOrEqual(1);
      }
      for (const w of plan.pitWindows) {
        expect(w.earliestLap).toBeLessThanOrEqual(w.latestLap);
      }
    }
  });
});
