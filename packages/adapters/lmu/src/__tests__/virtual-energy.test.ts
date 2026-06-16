import { raceStartState } from '@race-engineer/core/fixtures';
import { describe, expect, it } from 'vitest';
import { virtualEnergyFromRest, withVirtualEnergyFromRest } from '../rest/virtual-energy';

/**
 * The exact `/rest/strategy/usage` + `/rest/garage/UIScreen/RepairAndRefuel` field names are
 * LIVE-VERIFY (docs/03 §S2) — these payloads use the *plausible* shapes the tolerant mapper probes.
 * Once a rig capture pins the real keys, tighten the fixtures + candidate lists to match.
 */

describe('virtualEnergyFromRest (LMU REST → canonical VE; field names LIVE-VERIFY)', () => {
  it('maps a percentage level + per-lap usage into a 0..1 VE block', () => {
    const ve = virtualEnergyFromRest({ virtualEnergyPerLap: 5.2 }, { virtualEnergy: 84 })!;
    expect(ve.level01).toBeCloseTo(0.84);
    expect(ve.perLapAvg01).toBeCloseTo(0.052);
    expect(ve.lapsRemainingEst).toBeCloseTo(0.84 / 0.052, 4); // ~16 laps on VE
  });

  it('accepts values already given as 0..1 fractions (no double-scaling)', () => {
    const ve = virtualEnergyFromRest({ perLap: 0.05 }, { energy: 0.5 })!;
    expect(ve.level01).toBeCloseTo(0.5);
    expect(ve.perLapAvg01).toBeCloseTo(0.05);
  });

  it('reads the level from a nested object (one level deep)', () => {
    const ve = virtualEnergyFromRest({}, { virtualEnergy: { level: 60 } })!;
    expect(ve.level01).toBeCloseTo(0.6);
    expect(ve.perLapAvg01).toBeNull(); // no per-lap key present
    expect(ve.lapsRemainingEst).toBeNull();
  });

  it('falls back to strategyUsage for the level when the refuel screen is absent', () => {
    const ve = virtualEnergyFromRest({ energyLevel: 70, usagePerLap: 4 })!;
    expect(ve.level01).toBeCloseTo(0.7);
    expect(ve.perLapAvg01).toBeCloseTo(0.04);
  });

  it('returns null when no VE level can be found — never invents one', () => {
    expect(virtualEnergyFromRest(null, null)).toBeNull();
    expect(virtualEnergyFromRest({ unrelated: 1 }, { somethingElse: 2 })).toBeNull();
    expect(virtualEnergyFromRest('not an object')).toBeNull();
  });

  it('clamps a level to [0,1] and ignores non-finite values', () => {
    expect(virtualEnergyFromRest({}, { virtualEnergy: 130 })!.level01).toBe(1);
    expect(virtualEnergyFromRest({ perLap: Number.NaN }, { energy: 50 })!.perLapAvg01).toBeNull();
  });

  it('leaves lapsRemainingEst null when per-lap usage is zero or unknown', () => {
    expect(virtualEnergyFromRest({ perLap: 0 }, { energy: 50 })!.lapsRemainingEst).toBeNull();
  });
});

describe('withVirtualEnergyFromRest (merge into a SHM-derived RaceState)', () => {
  it('fills player.virtualEnergy from REST, leaving the rest of the state untouched', () => {
    const merged = withVirtualEnergyFromRest(raceStartState, {
      strategyUsage: { virtualEnergyPerLap: 5 },
      repairRefuel: { virtualEnergy: 90 },
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
