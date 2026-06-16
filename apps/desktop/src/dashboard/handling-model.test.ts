import { makeTire, multiClassTrafficState } from '@race-engineer/core/fixtures';
import type { RaceState, Tire } from '@race-engineer/core';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import { describe, expect, it } from 'vitest';
import { buildHandlingModel } from './handling-model';

const snap = (raceState: RaceState, seq = 1): EngineerSnapshot => ({
  seq,
  monotonicMs: raceState.monotonicMs,
  raceState,
});

/** A race state whose player runs the given 4 tyres (FL, FR, RL, RR). */
const withTires = (tires: [Tire, Tire, Tire, Tire]): RaceState => ({
  ...multiClassTrafficState,
  player: { ...multiClassTrafficState.player, tires },
});

const zone = (inner: number, center: number, outer: number): Tire =>
  makeTire({ tempC: { inner, center, outer } });
const flat = (c: number): Tire => makeTire({ tempC: c });

describe('buildHandlingModel', () => {
  it('reads a neutral, fully-confident balance from uniform 3-zone temps', () => {
    // Fixture tyres are uniform (92/89/86) → balanced corners, neutral balance, full zone data.
    const m = buildHandlingModel(snap(multiClassTrafficState));
    expect(m.available).toBe(true);
    expect(m.balance).toEqual({ value: 'Neutral', severity: 'good' });
    expect(m.frontTemp.value).toBe('89°');
    expect(m.rearTemp.value).toBe('89°');
    expect(m.confidence).toEqual({ value: '100%', severity: 'good' });
    expect(m.corners.every((c) => c.camber.severity === 'good')).toBe(true);
  });

  it('flags understeer when the fronts run hotter, as a caution', () => {
    const hot = zone(100, 100, 100);
    const cool = zone(80, 80, 80);
    const m = buildHandlingModel(snap(withTires([hot, hot, cool, cool])));
    expect(m.balance).toEqual({ value: 'Understeer', severity: 'caution' });
    expect(m.frontRearDelta.value).toBe('+20.0°');
  });

  it('flags oversteer when the rears run hotter', () => {
    const hot = zone(100, 100, 100);
    const cool = zone(80, 80, 80);
    const m = buildHandlingModel(snap(withTires([cool, cool, hot, hot])));
    expect(m.balance.value).toBe('Oversteer');
    expect(m.balance.severity).toBe('caution');
    expect(m.frontRearDelta.value).toBe('-20.0°');
  });

  it('surfaces a per-corner camber signal (inner hot) as a caution', () => {
    const cambered = zone(100, 92, 84); // inner − outer = 16 > 8 → inner-hot
    const even = zone(90, 90, 90);
    const m = buildHandlingModel(snap(withTires([cambered, even, even, even])));
    expect(m.corners[0]!.camber).toEqual({ value: 'Inner hot', severity: 'caution' });
    expect(m.corners[1]!.camber.severity).toBe('good'); // balanced
  });

  it('surfaces an over-inflated pressure signal (centre hot)', () => {
    const overinflated = zone(80, 100, 80); // centre − edges = 20 > 6 → over
    const even = zone(90, 90, 90);
    const m = buildHandlingModel(snap(withTires([overinflated, even, even, even])));
    expect(m.corners[0]!.pressure).toEqual({ value: 'Over-inflated', severity: 'caution' });
  });

  it('stays honest with single-value temps: corners unknown, confidence —, coarse balance only', () => {
    const m = buildHandlingModel(snap(withTires([flat(85), flat(85), flat(85), flat(85)])));
    expect(m.available).toBe(true); // a coarse axle-balance read is still possible
    expect(m.balance.value).toBe('Neutral');
    expect(m.confidence).toEqual({ value: '—', severity: 'unknown' });
    for (const c of m.corners) {
      expect(c.camber).toEqual({ value: '—', severity: 'unknown' });
      expect(c.pressure).toEqual({ value: '—', severity: 'unknown' });
    }
  });

  it('labels corners FL, FR, RL, RR in order and carries seq', () => {
    const m = buildHandlingModel(snap(multiClassTrafficState, 42));
    expect(m.corners.map((c) => c.corner)).toEqual(['FL', 'FR', 'RL', 'RR']);
    expect(m.seq).toBe(42);
  });
});
