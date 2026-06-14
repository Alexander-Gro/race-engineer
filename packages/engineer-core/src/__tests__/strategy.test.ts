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

  it('is silent (null plan) until it has learned anything — no deltas, no prior', () => {
    const f = frame({ liters: 80, laps: 0 });
    expect(run([f]).summary(f).fuelPlan).toBeNull();
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
});
