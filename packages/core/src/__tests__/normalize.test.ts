import { describe, expect, it } from 'vitest';
import {
  CANONICAL_WHEEL_ORDER,
  RollingFuel,
  barToKpa,
  createCanonicalNormalizer,
  kelvinToCelsius,
  kphToMps,
  mpsToKph,
  normalizeWear01,
  psiToKpa,
  reorderWheels,
} from '../normalize';
import { raceStartState } from '../fixtures';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('unit conversions', () => {
  it('converts speed between kph and m/s', () => {
    expect(kphToMps(36)).toBeCloseTo(10);
    expect(mpsToKph(10)).toBeCloseTo(36);
    expect(mpsToKph(kphToMps(123.4))).toBeCloseTo(123.4);
  });

  it('converts pressure and temperature', () => {
    expect(psiToKpa(1)).toBeCloseTo(6.8948, 3);
    expect(barToKpa(1.7)).toBeCloseTo(170);
    expect(kelvinToCelsius(373.15)).toBeCloseTo(100);
  });

  it('normalizes wear to 0..1 (0 = worn, 1 = new), clamped', () => {
    expect(normalizeWear01(5, 10)).toBeCloseTo(0.5);
    expect(normalizeWear01(20, 10)).toBe(1);
    expect(normalizeWear01(-1, 10)).toBe(0);
    expect(normalizeWear01(1, 0)).toBe(0);
  });
});

describe('wheel-order conversion', () => {
  it('reorders into canonical [FL, FR, RL, RR]', () => {
    // identity when source is already canonical
    expect(reorderWheels([1, 2, 3, 4], CANONICAL_WHEEL_ORDER)).toEqual([1, 2, 3, 4]);
    // a permuted source order
    expect(reorderWheels(['a', 'b', 'c', 'd'], ['RL', 'RR', 'FL', 'FR'])).toEqual([
      'c',
      'd',
      'a',
      'b',
    ]);
  });

  it('throws when a wheel is missing from the source', () => {
    expect(() => reorderWheels([1, 2, 3], ['FL', 'FR', 'RL'])).toThrow();
  });
});

describe('RollingFuel', () => {
  it('reports null until a lap boundary, then a rolling average', () => {
    const rf = new RollingFuel(5);
    expect(rf.update(30, 0)).toEqual({ perLapAvgLiters: null, lapsRemainingEst: null });
    expect(rf.update(28.5, 0)).toEqual({ perLapAvgLiters: null, lapsRemainingEst: null });

    const afterLap1 = rf.update(27, 1); // consumed 3 over lap 1
    expect(afterLap1.perLapAvgLiters).toBeCloseTo(3);
    expect(afterLap1.lapsRemainingEst).toBeCloseTo(9); // 27 / 3

    const afterLap2 = rf.update(24, 2); // consumed 3 over lap 2
    expect(afterLap2.perLapAvgLiters).toBeCloseTo(3);
    expect(afterLap2.lapsRemainingEst).toBeCloseTo(8); // 24 / 3
  });

  it('averages over the window of recent laps', () => {
    const rf = new RollingFuel(2);
    rf.update(30, 0);
    rf.update(27, 1); // 3
    rf.update(23, 2); // 4
    const last = rf.update(18, 3); // 5; window=2 keeps {4,5} -> avg 4.5
    expect(last.perLapAvgLiters).toBeCloseTo(4.5);
  });
});

describe('createCanonicalNormalizer', () => {
  const frame = (laps: number, liters: number) => {
    const f = clone(raceStartState);
    f.player.lapsCompleted = laps;
    f.player.fuel.liters = liters;
    return f;
  };

  it('fills rolling fuel-per-lap once a lap is observed', () => {
    const n = createCanonicalNormalizer();
    const r0 = n.toRaceState(frame(0, 30));
    expect(r0.player.fuel.perLapAvgLiters).toBeNull();
    expect(r0.player.fuel.lapsRemainingEst).toBeNull();

    const r1 = n.toRaceState(frame(1, 27));
    expect(r1.player.fuel.perLapAvgLiters).toBeCloseTo(3);
    expect(r1.player.fuel.lapsRemainingEst).toBeCloseTo(9);
  });

  it('does not mutate the input frame', () => {
    const n = createCanonicalNormalizer();
    const input = frame(1, 27);
    const before = input.player.fuel.perLapAvgLiters;
    const out = n.toRaceState(input);
    expect(input.player.fuel.perLapAvgLiters).toBe(before);
    expect(out).not.toBe(input);
    expect(out.player).not.toBe(input.player);
  });
});
