import { makeCarState, makePlayerCar, raceStartState } from '@race-engineer/core/fixtures';
import type { CarState, RaceState } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import { estimatePerLapConsumption } from '../fuel';
import { cleanLapValues, isStuckBehindTraffic, lapTrafficWeight } from '../traffic';

const frameWith = (rivals: Partial<CarState>[], playerInPit = false): RaceState => {
  const player = makePlayerCar({
    id: 99,
    position: 5,
    className: 'LMP2',
    pit: { inPitLane: playerInPit, inPitStall: false, stops: 0, state: 'none' },
  });
  return {
    ...raceStartState,
    player,
    cars: [player, ...rivals.map((r, i) => makeCarState({ id: i + 1, position: 6 + i, ...r }))],
  };
};

describe('isStuckBehindTraffic', () => {
  it('is true when a car sits just ahead within the dirty-air gap', () => {
    expect(isStuckBehindTraffic(frameWith([{ gapToPlayerS: -0.6, className: 'GTE' }]))).toBe(true);
  });

  it('is false when the car ahead is beyond the dirty-air gap, or behind, or there is none', () => {
    expect(isStuckBehindTraffic(frameWith([{ gapToPlayerS: -2.0 }]))).toBe(false); // clear air ahead
    expect(isStuckBehindTraffic(frameWith([{ gapToPlayerS: 0.5 }]))).toBe(false); // behind you
    expect(isStuckBehindTraffic(frameWith([]))).toBe(false);
  });

  it('honours a wider gap and the different-class-only option', () => {
    const f = frameWith([{ gapToPlayerS: -1.4, className: 'LMP2' }]);
    expect(isStuckBehindTraffic(f, { stuckGapS: 2 })).toBe(true); // 1.4 within 2.0
    expect(isStuckBehindTraffic(f, { stuckGapS: 2, differentClassOnly: true })).toBe(false); // same class
  });

  it('never reports traffic while the player is in the pit lane', () => {
    expect(isStuckBehindTraffic(frameWith([{ gapToPlayerS: -0.3 }], true))).toBe(false);
  });
});

describe('lapTrafficWeight', () => {
  it('is 1 − fraction, clamped to [0, 1]', () => {
    expect(lapTrafficWeight(0)).toBe(1);
    expect(lapTrafficWeight(0.3)).toBeCloseTo(0.7, 6);
    expect(lapTrafficWeight(1)).toBe(0);
    expect(lapTrafficWeight(-1)).toBe(1); // clamped
    expect(lapTrafficWeight(2)).toBe(0); // clamped
  });

  it('fully discards a lap once it exceeds the discard threshold', () => {
    expect(lapTrafficWeight(0.6, { discardAbove01: 0.5 })).toBe(0);
    expect(lapTrafficWeight(0.4, { discardAbove01: 0.5 })).toBeCloseTo(0.6, 6);
  });
});

describe('cleanLapValues', () => {
  const samples = [
    { value: 2.6, contaminatedFraction01: 0.0 }, // clean
    { value: 2.7, contaminatedFraction01: 0.2 }, // lightly dirty
    { value: 3.4, contaminatedFraction01: 0.6 }, // mostly in traffic
    { value: 3.9, contaminatedFraction01: 0.9 }, // stuck the whole lap
  ];

  it('keeps only laps clean enough (weight ≥ minWeight, default 0.5)', () => {
    expect(cleanLapValues(samples)).toEqual([2.6, 2.7]);
  });

  it('stops the contaminated laps poisoning the consumption estimate (docs/05 §6)', () => {
    // Raw deltas include the inflated traffic laps; cleaned deltas don't.
    const raw = estimatePerLapConsumption({ greenLapFuelDeltas: samples.map((s) => s.value) });
    const clean = estimatePerLapConsumption({ greenLapFuelDeltas: cleanLapValues(samples) });
    expect(clean.perLapLiters!).toBeLessThan(raw.perLapLiters!);
    expect(clean.perLapLiters!).toBeCloseTo(2.65, 6); // median of [2.6, 2.7]
  });
});
