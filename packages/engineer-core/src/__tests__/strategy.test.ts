import type { RaceState } from '@race-engineer/core';
import { raceStartState } from '@race-engineer/core/fixtures';
import { describe, expect, it } from 'vitest';
import { StrategyEngine } from '../strategy';

const frame = (opts: {
  liters: number;
  laps: number;
  lastLapS?: number | null;
  perLapAvg?: number | null;
  remainingS?: number | null;
  flag?: RaceState['flags']['global'];
}): RaceState => ({
  ...raceStartState,
  flags: { ...raceStartState.flags, global: opts.flag ?? 'green' },
  session: { ...raceStartState.session, isTimed: true, remainingS: opts.remainingS ?? 1800 },
  player: {
    ...raceStartState.player,
    lapsCompleted: opts.laps,
    lastLapS: opts.lastLapS ?? null,
    bestLapS: 100,
    fuel: {
      ...raceStartState.player.fuel,
      liters: opts.liters,
      perLapAvgLiters: opts.perLapAvg ?? null,
      lapsRemainingEst: null,
    },
  },
});

const run = (frames: RaceState[]): StrategyEngine => {
  const engine = new StrategyEngine();
  for (const f of frames) engine.observe(f);
  return engine;
};

describe('StrategyEngine', () => {
  it('learns per-lap consumption from green-lap fuel deltas and plans laps remaining', () => {
    const frames = [
      frame({ liters: 80, laps: 0 }),
      frame({ liters: 77.5, laps: 1, lastLapS: 100 }), // burned 2.5
      frame({ liters: 75, laps: 2, lastLapS: 100 }),
      frame({ liters: 72.5, laps: 3, lastLapS: 100 }),
    ];
    const { fuelPlan } = run(frames).summary(frames.at(-1)!);
    expect(fuelPlan).not.toBeNull();
    expect(fuelPlan!.perLapLiters).toBeCloseTo(2.5, 6);
    expect(fuelPlan!.lapsRemainingOnFuel).toBeCloseTo(72.5 / 2.5, 6); // 29
    expect(fuelPlan!.confidence01).toBeGreaterThan(0);
    expect(fuelPlan!.confidence01).toBeLessThanOrEqual(1);
  });

  it('is silent (null fuel + stint plan) until it has learned anything — no deltas, no prior', () => {
    const f = frame({ liters: 80, laps: 0 });
    const { fuelPlan, stintPlan } = run([f]).summary(f);
    expect(fuelPlan).toBeNull();
    expect(stintPlan).toBeNull();
  });

  it('plans the rest of the race (fuel-bound stints + a pit window) from the current lap', () => {
    const frames = [
      frame({ liters: 80, laps: 0 }),
      frame({ liters: 77.5, laps: 1, lastLapS: 100 }), // 2.5 L/lap, 100 s/lap
      frame({ liters: 75, laps: 2, lastLapS: 100 }),
      frame({ liters: 72.5, laps: 3, lastLapS: 100, remainingS: 5000 }), // ~50 laps left
    ];
    const { stintPlan } = run(frames).summary(frames.at(-1)!);
    expect(stintPlan).not.toBeNull();
    expect(stintPlan!.stints.length).toBe(2); // 50 laps doesn't fit one 80 L tank
    expect(stintPlan!.pitWindows.length).toBe(1);
    expect(stintPlan!.stints[0]!.startLap).toBe(3); // plans from the current lap, not lap 0
  });

  it("seeds from the Normalizer's rolling estimate so a plan is available immediately", () => {
    const f = frame({ liters: 60, laps: 0, perLapAvg: 2.6 });
    const { fuelPlan } = run([f]).summary(f);
    expect(fuelPlan).not.toBeNull();
    expect(fuelPlan!.perLapLiters).toBeCloseTo(2.6, 6); // from the prior
  });

  it('drops a refuel (fuel increase) from the consumption estimate', () => {
    const frames = [
      frame({ liters: 80, laps: 0 }),
      frame({ liters: 77.5, laps: 1, lastLapS: 100 }), // −2.5 burn
      frame({ liters: 90, laps: 2, lastLapS: 100 }), // +12.5 refuel → excluded
      frame({ liters: 87.5, laps: 3, lastLapS: 100 }), // −2.5 burn
    ];
    expect(run(frames).summary(frames.at(-1)!).fuelPlan!.perLapLiters).toBeCloseTo(2.5, 6);
  });

  it('excludes non-green laps (FCY) from the consumption estimate', () => {
    const frames = [
      frame({ liters: 80, laps: 0 }),
      frame({ liters: 76, laps: 1, lastLapS: 100, flag: 'fcy' }), // −4 under caution → excluded
      frame({ liters: 73.5, laps: 2, lastLapS: 100, flag: 'green' }), // −2.5 green
    ];
    expect(run(frames).summary(frames.at(-1)!).fuelPlan!.perLapLiters).toBeCloseTo(2.5, 6);
  });

  it('excludes a lap that went under caution mid-lap, even if it completes green (review)', () => {
    const frames = [
      frame({ liters: 80, laps: 0 }),
      frame({ liters: 78, laps: 0, flag: 'fcy' }), // caution drops mid-lap (no boundary)
      frame({ liters: 76, laps: 1, lastLapS: 100, flag: 'green' }), // lap completes back under green
      frame({ liters: 73.5, laps: 2, lastLapS: 100, flag: 'green' }), // a clean green lap
    ];
    // The first lap is tainted by the mid-lap FCY tick; only the clean lap (2.5) counts.
    expect(run(frames).summary(frames.at(-1)!).fuelPlan!.perLapLiters).toBeCloseTo(2.5, 6);
  });

  it('averages a multi-lap jump (dropped frames) instead of counting it as one lap (review)', () => {
    const frames = [
      frame({ liters: 80, laps: 0 }),
      frame({ liters: 75, laps: 2, lastLapS: 100 }), // jumped 2 laps: 5 L over 2 = 2.5/lap, not 5
    ];
    expect(run(frames).summary(frames.at(-1)!).fuelPlan!.perLapLiters).toBeCloseTo(2.5, 6);
  });

  it('clears stale history when the lap count goes backwards — restart / loop (review)', () => {
    const frames = [
      frame({ liters: 80, laps: 0 }),
      frame({ liters: 70, laps: 1, lastLapS: 100 }), // old session: 10 L/lap
      frame({ liters: 60, laps: 2, lastLapS: 100 }),
      frame({ liters: 80, laps: 0 }), // restart: laps reset, full tank
      frame({ liters: 77.5, laps: 1, lastLapS: 100 }), // new session: 2.5 L/lap
    ];
    // Only the new session's lap counts — not the heavy 10 L/lap of the old one.
    expect(run(frames).summary(frames.at(-1)!).fuelPlan!.perLapLiters).toBeCloseTo(2.5, 6);
  });
});
