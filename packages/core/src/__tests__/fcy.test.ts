import { describe, expect, it } from 'vitest';
import { EventDetector, fcyRule, isUnderCaution } from '../events';
import type { EngineerEvent, FlagState, RaceState } from '../schema';
import { raceStartState } from '../fixtures';

const frame = (
  global: FlagState['global'],
  opts: { tick?: number; monotonicMs?: number; inPitLane?: boolean } = {},
): RaceState => ({
  ...raceStartState,
  tick: opts.tick ?? 0,
  monotonicMs: opts.monotonicMs ?? 0,
  player: {
    ...raceStartState.player,
    pit: { ...raceStartState.player.pit, inPitLane: opts.inPitLane ?? false },
  },
  flags: { ...raceStartState.flags, global },
});

/** Run an arc of (global, ms) frames through a detector and collect every emitted event. */
const run = (arc: Array<[FlagState['global'], number, boolean?]>): EngineerEvent[] => {
  const detector = new EventDetector([fcyRule()]);
  const emitted: EngineerEvent[] = [];
  arc.forEach(([global, ms, inPit], i) => {
    emitted.push(
      ...detector.process(frame(global, { tick: i, monotonicMs: ms, inPitLane: inPit })),
    );
  });
  return emitted;
};

describe('isUnderCaution', () => {
  it('is true only for fcy / safetyCar', () => {
    expect(isUnderCaution(frame('fcy'))).toBe(true);
    expect(isUnderCaution(frame('safetyCar'))).toBe(true);
    expect(isUnderCaution(frame('green'))).toBe(false);
    expect(isUnderCaution(frame('yellow'))).toBe(false); // a local yellow is not a full-course caution
  });
});

describe('fcyRule', () => {
  it('fires one Tier-2 fcy_opportunity on the green→FCY edge, not while it sustains', () => {
    const events = run([
      ['green', 0],
      ['fcy', 1000],
      ['fcy', 2000],
      ['fcy', 3000],
    ]);
    const fcy = events.filter((e) => e.type === 'fcy_opportunity');
    expect(fcy).toHaveLength(1);
    expect(fcy[0]?.tier).toBe(2);
    expect(fcy[0]?.payload.caution).toBe('fcy');
    expect(fcy[0]?.dedupeKey).toBe('fcy_opportunity');
  });

  it('treats a safety car the same as an FCY', () => {
    const events = run([
      ['green', 0],
      ['safetyCar', 1000],
    ]);
    const fcy = events.filter((e) => e.type === 'fcy_opportunity');
    expect(fcy).toHaveLength(1);
    expect(fcy[0]?.payload.caution).toBe('safetyCar');
  });

  it('fires on the first tick if the session opens under caution', () => {
    expect(run([['fcy', 0]]).filter((e) => e.type === 'fcy_opportunity')).toHaveLength(1);
  });

  it('does not flag an opportunity while the player is already in the pit lane', () => {
    const events = run([
      ['green', 0],
      ['fcy', 1000, true], // caution drops while already pitting → no opportunity to flag
    ]);
    expect(events.filter((e) => e.type === 'fcy_opportunity')).toHaveLength(0);
  });

  it('re-arms for a later caution once the cooldown has elapsed', () => {
    const events = run([
      ['green', 0],
      ['fcy', 1000], // emit
      ['fcy', 2000], // sustain → none
      ['green', 3000], // back to green
      ['fcy', 40000], // new caution, >30 s later → emit again
    ]);
    expect(events.filter((e) => e.type === 'fcy_opportunity')).toHaveLength(2);
  });
});
