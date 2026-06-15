import { describe, expect, expectTypeOf, it } from 'vitest';
import { EngineerEventSchema, FuelPlanSchema } from '../schema';
import type { EngineerEvent, FuelPlan, RaceState, Tire, WeatherState, WheelArray } from '../schema';
import { isFuelPlan, isRaceState, parseRaceState, safeParseRaceState } from '../validators';
import { raceStartState } from '../fixtures';

// Deep-clone a fixture so a negative test can corrupt one field without touching the original.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('RaceState validators', () => {
  it('accepts a valid RaceState', () => {
    expect(() => parseRaceState(raceStartState)).not.toThrow();
    expect(isRaceState(raceStartState)).toBe(true);
    expect(safeParseRaceState(raceStartState).success).toBe(true);
  });

  it('accepts a negative lapDistanceM (just behind the S/F line — docs/03 §S1#2)', () => {
    // rF2/LMU reports a small negative lap distance on the out/formation lap and at the moment of
    // crossing the line. Found replaying a live capture: a `>= 0` constraint rejected real frames.
    const behindLine = clone(raceStartState);
    behindLine.player.lapDistanceM = -42.5;
    expect(safeParseRaceState(behindLine).success).toBe(true);
  });

  it('rejects non-objects and empty objects', () => {
    expect(isRaceState(null)).toBe(false);
    expect(isRaceState(42)).toBe(false);
    expect(safeParseRaceState({}).success).toBe(false);
  });

  it('rejects out-of-range and wrong-typed fields', () => {
    const badWear = clone(raceStartState);
    badWear.player.tires[0].wear01 = 1.5; // outside [0, 1]
    expect(safeParseRaceState(badWear).success).toBe(false);

    const badFlag = clone(raceStartState);
    (badFlag.flags as { global: unknown }).global = 'mauve'; // not a real flag
    expect(safeParseRaceState(badFlag).success).toBe(false);

    const badFuelType = clone(raceStartState);
    (badFuelType.player.fuel as { liters: unknown }).liters = 'lots';
    expect(safeParseRaceState(badFuelType).success).toBe(false);
  });
});

describe('strategy & event validation', () => {
  const fuelPlan: FuelPlan = {
    perLapLiters: 3.1,
    lapsRemainingOnFuel: 13.5,
    lapsToFinish: 70,
    litersToFinish: 217,
    litersToAddNextStop: 80,
    fuelSaveTargetLitersPerLap: null,
    confidence01: 0.62,
  };

  it('FuelPlan.confidence01 must be within [0, 1]', () => {
    expect(isFuelPlan(fuelPlan)).toBe(true);
    expect(isFuelPlan({ ...fuelPlan, confidence01: 1.4 })).toBe(false);
    expect(isFuelPlan({ ...fuelPlan, confidence01: -0.1 })).toBe(false);
  });

  it('FuelPlanSchema rejects negative consumption', () => {
    expect(FuelPlanSchema.safeParse({ ...fuelPlan, perLapLiters: -1 }).success).toBe(false);
  });

  const event: EngineerEvent = {
    id: 'evt-1',
    tick: 211200,
    type: 'fuel_low',
    tier: 1,
    priority: 8,
    payload: { lapsRemaining: 1.06 },
  };

  it('EngineerEvent constrains tier and type', () => {
    expect(EngineerEventSchema.safeParse(event).success).toBe(true);
    expect(EngineerEventSchema.safeParse({ ...event, tier: 9 }).success).toBe(false);
    expect(EngineerEventSchema.safeParse({ ...event, type: 'not_an_event' }).success).toBe(false);
  });
});

describe('type-level guarantees (compile-time)', () => {
  it('schema-inferred types match the documented shapes', () => {
    expectTypeOf<RaceState['player']['tires']>().toEqualTypeOf<WheelArray<Tire>>();
    expectTypeOf<EngineerEvent['tier']>().toEqualTypeOf<0 | 1 | 2 | 3>();
    expectTypeOf<RaceState['session']['game']>().toEqualTypeOf<'lmu'>();
    expectTypeOf<RaceState['weather']>().toEqualTypeOf<WeatherState | null>();
    expectTypeOf<FuelPlan['confidence01']>().toBeNumber();
  });
});
