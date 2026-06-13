import { describe, expect, it } from 'vitest';
import { RaceStateSchema } from '@race-engineer/core';
import type { CarState, RaceState } from '@race-engineer/core';
import { defaultSyntheticConfig, scriptedScenario, synthesizeFrames } from '../synthetic';

const at = <T>(arr: readonly T[], i: number): T => {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
};

const duelCar = (f: RaceState): CarState | undefined => f.cars.find((c) => c.id === 2);
const duelGapS = (f: RaceState): number | null => duelCar(f)?.gapToPlayerS ?? null;
const round = (v: number, dp = 2): number => Math.round(v * 10 ** dp) / 10 ** dp;

describe('synthetic generator', () => {
  it('is deterministic: same config yields identical frames', () => {
    const a = synthesizeFrames(scriptedScenario());
    const b = synthesizeFrames(scriptedScenario());
    expect(a).toEqual(b);
    expect(a).toHaveLength(600);
  });

  it('produces a schema-valid RaceState sequence', () => {
    for (const cfg of [defaultSyntheticConfig(), scriptedScenario()]) {
      for (const frame of synthesizeFrames(cfg)) {
        const result = RaceStateSchema.safeParse(frame);
        expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(
          true,
        );
      }
    }
  });

  it('scripts an overtake: the duellist gap crosses from behind (+) to ahead (-)', () => {
    const frames = synthesizeFrames(scriptedScenario());
    expect(duelGapS(at(frames, 0)) ?? 0).toBeGreaterThan(0); // starts behind
    expect(duelGapS(at(frames, frames.length - 1)) ?? 0).toBeLessThan(0); // ends ahead

    let prev: number | null = null;
    let crossings = 0;
    for (const f of frames) {
      const g = duelGapS(f);
      if (prev !== null && g !== null && Math.sign(prev) !== Math.sign(g)) crossings += 1;
      prev = g;
    }
    expect(crossings).toBe(1); // a single, clean overtake
  });

  it('runs a fuel-low arc: under two laps of fuel by the end, never negative, monotonic', () => {
    const frames = synthesizeFrames(scriptedScenario());
    const last = at(frames, frames.length - 1);
    expect(last.player.fuel.liters).toBeGreaterThanOrEqual(0);
    expect(last.player.fuel.lapsRemainingEst ?? Number.POSITIVE_INFINITY).toBeLessThan(2);

    let prev = Number.POSITIVE_INFINITY;
    for (const f of frames) {
      expect(f.player.fuel.liters).toBeLessThanOrEqual(prev + 1e-9);
      prev = f.player.fuel.liters;
    }
  });

  it('matches the scripted-scenario per-lap summary (snapshot)', () => {
    const frames = synthesizeFrames(scriptedScenario());
    const lastTick = at(frames, frames.length - 1).tick;
    const summary = frames
      .filter((f) => f.tick % 60 === 0 || f.tick === lastTick)
      .map((f) => {
        const gap = duelGapS(f);
        return {
          tick: f.tick,
          playerLap: f.player.lapsCompleted,
          playerPos: f.player.position,
          fuelL: round(f.player.fuel.liters),
          lapsRemaining:
            f.player.fuel.lapsRemainingEst === null ? null : round(f.player.fuel.lapsRemainingEst),
          duelPos: duelCar(f)?.position ?? null,
          duelGapS: gap === null ? null : round(gap),
        };
      });
    expect(summary).toMatchSnapshot();
  });
});
