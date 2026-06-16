import { raceStartState } from '@race-engineer/core/fixtures';
import type { RaceState } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import { aidsFromRest, withAidsFromRest } from '../rest/aids';

/**
 * Field names + shape confirmed against a live rig capture (docs/03 §S2, 2026-06-16): each aid is a
 * `VM_*` object on the garage payload carrying `value` + `minValue`/`maxValue` (+ a display
 * `stringValue`). Captured: TC value 5 (0–12), ABS value 9 (0–10), engine mixture value 1 (0–2).
 */

/** A SHM-derived state with the aid indices unread (what the LMU SHM normalizer produces). */
const shmState: RaceState = {
  ...raceStartState,
  player: {
    ...raceStartState.player,
    aids: { tc: null, abs: null, brakeBias: { frontPct: 54 } },
    engine: { ...raceStartState.player.engine, map: null },
  },
};

/** A garage payload shaped like the real LMU `getPlayerGarageData` (confirmed VM_* aid objects). */
const garage = {
  VM_TRACTIONCONTROLMAP: { value: 5, minValue: 0, maxValue: 12, stringValue: '5' },
  VM_ANTILOCKBRAKESYSTEMMAP: { value: 9, minValue: 0, maxValue: 10, stringValue: '9 (Understeer)' },
  VM_ENGINE_MIXTURE: { value: 1, minValue: 0, maxValue: 2, stringValue: 'Race' },
};

describe('aidsFromRest (LMU REST garage → canonical aids; VM_* confirmed on the rig)', () => {
  it('maps TC / ABS / engine-mixture from the VM_* objects with their real ranges', () => {
    const a = aidsFromRest(garage);
    expect(a.tc).toEqual({ value: 5, min: 0, max: 12 });
    expect(a.abs).toEqual({ value: 9, min: 0, max: 10 });
    expect(a.engineMap).toBe(1);
  });

  it('falls back to the refuel screen and tolerates a missing range', () => {
    const a = aidsFromRest(
      { VM_TRACTIONCONTROLMAP: { value: 6 } }, // no min/max present
      { VM_ENGINE_MIXTURE: { value: 2, minValue: 0, maxValue: 2 } },
    );
    expect(a.tc).toEqual({ value: 6, min: null, max: null });
    expect(a.engineMap).toBe(2); // from the repairRefuel fallback
    expect(a.abs).toBeNull(); // not present anywhere
  });

  it('returns nulls when nothing matches — never a guessed index', () => {
    const a = aidsFromRest({ unrelated: 1 }, null);
    expect(a.tc).toBeNull();
    expect(a.abs).toBeNull();
    expect(a.engineMap).toBeNull();
    expect(aidsFromRest(null)).toEqual({ tc: null, abs: null, engineMap: null });
  });
});

describe('withAidsFromRest (merge into a SHM-derived RaceState)', () => {
  it('fills the aid indices SHM left null (with the REST range), leaving the rest untouched', () => {
    const merged = withAidsFromRest(shmState, { garage });
    expect(merged.player.aids.tc).toEqual({ value: 5, min: 0, max: 12 });
    expect(merged.player.aids.abs).toEqual({ value: 9, min: 0, max: 10 });
    expect(merged.player.engine.map).toBe(1);
    expect(merged.player.aids.brakeBias).toEqual({ frontPct: 54 }); // SHM-owned, untouched
    expect(merged).not.toBe(shmState); // pure: new object
  });

  it('prefers SHM where it already has a value (does not override)', () => {
    const populated: RaceState = {
      ...raceStartState,
      player: {
        ...raceStartState.player,
        aids: {
          tc: { value: 2, min: 0, max: 11 },
          abs: { value: 1, min: 0, max: 11 },
          brakeBias: { frontPct: 54 },
        },
        engine: { ...raceStartState.player.engine, map: 3 },
      },
    };
    const merged = withAidsFromRest(populated, { garage });
    expect(merged).toBe(populated); // nothing to fill → same reference
    expect(merged.player.aids.tc?.value).toBe(2);
    expect(merged.player.aids.abs?.value).toBe(1);
    expect(merged.player.engine.map).toBe(3);
  });

  it('returns the state unchanged when REST adds nothing', () => {
    const merged = withAidsFromRest(shmState, { garage: {}, repairRefuel: {} });
    expect(merged).toBe(shmState);
    expect(merged.player.aids.tc).toBeNull();
  });
});
