import { describe, expect, it } from 'vitest';
import { RaceStateSchema } from '../schema';
import {
  allFixtures,
  lowFuelState,
  midStintState,
  multiClassTrafficState,
  raceStartState,
} from '../fixtures';

describe('canonical fixtures', () => {
  it('every fixture validates against RaceStateSchema', () => {
    for (const [name, fx] of Object.entries(allFixtures)) {
      const result = RaceStateSchema.safeParse(fx);
      expect(
        result.success,
        result.success ? '' : `${name}: ${JSON.stringify(result.error.issues, null, 2)}`,
      ).toBe(true);
    }
  });

  it('player wheel arrays are 4-tuples (FL, FR, RL, RR)', () => {
    for (const fx of Object.values(allFixtures)) {
      expect(fx.player.tires).toHaveLength(4);
      expect(fx.player.brakes).toHaveLength(4);
    }
  });

  it('race start: cold start — no rolling fuel data yet, tanks near full', () => {
    expect(raceStartState.session.phase).toBe('race');
    expect(raceStartState.player.lapsCompleted).toBe(0);
    expect(raceStartState.player.fuel.perLapAvgLiters).toBeNull();
    expect(raceStartState.player.fuel.lapsRemainingEst).toBeNull();
    expect(raceStartState.player.fuel.liters).toBeGreaterThan(70);
  });

  it('mid stint: rolling fuel rate known and laps-remaining derived', () => {
    expect(midStintState.player.fuel.perLapAvgLiters).toBeGreaterThan(0);
    expect(midStintState.player.fuel.lapsRemainingEst ?? 0).toBeGreaterThan(2);
    expect(midStintState.player.lastLapS).not.toBeNull();
  });

  it('low fuel: under two laps of fuel remaining', () => {
    const est = lowFuelState.player.fuel.lapsRemainingEst;
    expect(est).not.toBeNull();
    expect(est ?? Number.POSITIVE_INFINITY).toBeLessThan(2);
  });

  it('multi-class traffic: 3+ classes, blue flag for player, spotter geometry present', () => {
    const classes = new Set(multiClassTrafficState.cars.map((c) => c.classId));
    expect(classes.size).toBeGreaterThanOrEqual(3);
    expect(multiClassTrafficState.session.multiClass).toBe(true);
    expect(multiClassTrafficState.flags.blueForPlayer).toBe(true);

    const closingNeighbour = multiClassTrafficState.cars.some(
      (c) => !c.isPlayer && c.worldPos !== null && c.closingRateMps !== null,
    );
    expect(closingNeighbour).toBe(true);
  });
});
