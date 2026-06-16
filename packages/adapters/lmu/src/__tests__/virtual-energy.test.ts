import { raceStartState } from '@race-engineer/core/fixtures';
import { describe, expect, it } from 'vitest';
import { virtualEnergyFromRest, withVirtualEnergyFromRest } from '../rest/virtual-energy';

/**
 * Shape confirmed against a live rig capture (docs/03 §S2, 2026-06-16): VE comes from
 * `/rest/garage/UIScreen/RepairAndRefuel` as `fuelInfo.currentVirtualEnergy` / `maxVirtualEnergy`
 * (raw units, e.g. 668372288 / 673000000) — a current/max ratio, not a percentage. Tolerant fallbacks
 * cover a single pre-normalized value on other builds.
 */

describe('virtualEnergyFromRest (LMU REST → canonical VE; current/max confirmed on the rig)', () => {
  it('maps the confirmed current/max raw pair into a 0..1 level', () => {
    const ve = virtualEnergyFromRest(
      {},
      { fuelInfo: { currentVirtualEnergy: 668372288, maxVirtualEnergy: 673000000 } },
    )!;
    expect(ve.level01).toBeCloseTo(0.9931, 4);
    expect(ve.perLapAvg01).toBeNull(); // no per-lap key in the refuel payload — the engine learns it
    expect(ve.lapsRemainingEst).toBeNull();
  });

  it('computes laps-remaining from current/max + a per-lap usage key', () => {
    const ve = virtualEnergyFromRest(
      { energyPerLap: 5 },
      { fuelInfo: { currentVirtualEnergy: 50, maxVirtualEnergy: 100 } },
    )!;
    expect(ve.level01).toBeCloseTo(0.5);
    expect(ve.perLapAvg01).toBeCloseTo(0.05);
    expect(ve.lapsRemainingEst).toBeCloseTo(10);
  });

  it('falls back to a single pre-normalized value when no max is present (% or 0..1)', () => {
    expect(virtualEnergyFromRest({}, { virtualEnergy: 84 })!.level01).toBeCloseTo(0.84);
    expect(virtualEnergyFromRest({}, { energy: 0.5 })!.level01).toBeCloseTo(0.5);
  });

  it('falls back to strategyUsage for the level when the refuel screen is absent', () => {
    const ve = virtualEnergyFromRest({ currentVirtualEnergy: 70, maxVirtualEnergy: 100 })!;
    expect(ve.level01).toBeCloseTo(0.7);
  });

  it('returns null when no VE level can be found — never invents one', () => {
    expect(virtualEnergyFromRest(null, null)).toBeNull();
    expect(virtualEnergyFromRest({ unrelated: 1 }, { somethingElse: 2 })).toBeNull();
    expect(virtualEnergyFromRest('not an object')).toBeNull();
  });

  it('clamps the ratio to [0,1] and ignores a non-finite per-lap', () => {
    expect(
      virtualEnergyFromRest({}, { fuelInfo: { currentVirtualEnergy: 130, maxVirtualEnergy: 100 } })!
        .level01,
    ).toBe(1);
    expect(
      virtualEnergyFromRest({ perLap: Number.NaN }, { virtualEnergy: 50 })!.perLapAvg01,
    ).toBeNull();
  });

  it('leaves lapsRemainingEst null when per-lap usage is zero or unknown', () => {
    expect(
      virtualEnergyFromRest({ perLap: 0 }, { virtualEnergy: 50 })!.lapsRemainingEst,
    ).toBeNull();
  });
});

describe('withVirtualEnergyFromRest (merge into a SHM-derived RaceState)', () => {
  it('fills player.virtualEnergy from REST, leaving the rest of the state untouched', () => {
    const merged = withVirtualEnergyFromRest(raceStartState, {
      strategyUsage: {},
      repairRefuel: { fuelInfo: { currentVirtualEnergy: 90, maxVirtualEnergy: 100 } },
    });
    expect(merged.player.virtualEnergy).not.toBeNull();
    expect(merged.player.virtualEnergy!.level01).toBeCloseTo(0.9);
    expect(merged.player.fuel).toEqual(raceStartState.player.fuel); // fuel untouched
    expect(merged).not.toBe(raceStartState); // returns a new object (pure)
  });

  it('returns the state unchanged when REST exposes no VE (stays null from SHM)', () => {
    const merged = withVirtualEnergyFromRest(raceStartState, {
      strategyUsage: {},
      repairRefuel: {},
    });
    expect(merged).toBe(raceStartState);
    expect(merged.player.virtualEnergy).toBeNull();
  });
});
