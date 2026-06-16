import { raceStartState } from '@race-engineer/core/fixtures';
import type { RaceState } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import { aidsFromRest, withAidsFromRest } from '../rest/aids';

/**
 * REST garage field names are LIVE-VERIFY (docs/03 §S2/§S3) — these payloads use the *plausible* keys
 * the tolerant reader probes. Confirm/narrow them from a real rig capture, then tighten the lists.
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

describe('aidsFromRest (LMU REST garage → canonical aids; field names LIVE-VERIFY)', () => {
  it('maps TC / ABS / engine-map indices from the garage payload', () => {
    const a = aidsFromRest({ tractionControl: 4, abs: 3, engineMap: 5 });
    expect(a.tc).toEqual({ value: 4, min: null, max: null });
    expect(a.abs).toEqual({ value: 3, min: null, max: null });
    expect(a.engineMap).toBe(5);
  });

  it('reads from a nested object and falls back to the refuel screen', () => {
    const a = aidsFromRest({ aids: { tc: 6 } }, { engineMix: 2 });
    expect(a.tc?.value).toBe(6);
    expect(a.engineMap).toBe(2); // from repairRefuel fallback (engineMix alias)
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
  it('fills the aid indices SHM left null, leaving the rest of the state untouched', () => {
    const merged = withAidsFromRest(shmState, {
      garage: { tractionControl: 4, abs: 3, engineMap: 5 },
    });
    expect(merged.player.aids.tc).toEqual({ value: 4, min: null, max: null });
    expect(merged.player.aids.abs).toEqual({ value: 3, min: null, max: null });
    expect(merged.player.engine.map).toBe(5);
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
    const merged = withAidsFromRest(populated, {
      garage: { tractionControl: 9, abs: 9, engineMap: 9 },
    });
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
