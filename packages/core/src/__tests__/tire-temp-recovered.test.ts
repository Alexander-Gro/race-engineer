import { describe, expect, it } from 'vitest';
import { EventDetector, tireTempRecoveredRule } from '../events';
import type { EngineerEvent, RaceState, SessionState, Tire } from '../schema';
import { makeTire, raceStartState } from '../fixtures';

const frame = (opts: {
  tempsC: [number, number, number, number];
  monotonicMs?: number;
  inPitLane?: boolean;
  phase?: SessionState['phase'];
}): RaceState => ({
  ...raceStartState,
  tick: opts.monotonicMs ?? 0,
  monotonicMs: opts.monotonicMs ?? 0,
  session: { ...raceStartState.session, phase: opts.phase ?? 'race' },
  player: {
    ...raceStartState.player,
    tires: opts.tempsC.map((c) => makeTire({ tempC: c })) as [Tire, Tire, Tire, Tire],
    pit: { ...raceStartState.player.pit, inPitLane: opts.inPitLane ?? false },
  },
});

const run = (frames: RaceState[]): EngineerEvent[] => {
  const detector = new EventDetector([tireTempRecoveredRule()]);
  return frames.flatMap((f) => detector.process(f));
};

describe('tireTempRecoveredRule', () => {
  it('fires on the cold → in-window edge (tyres up to temp after the start)', () => {
    const events = run([
      frame({ tempsC: [60, 65, 70, 68], monotonicMs: 0 }), // cold off the formation lap
      frame({ tempsC: [85, 88, 90, 87], monotonicMs: 1000 }), // now all in the window
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('tire_temp_recovered');
    expect(events[0]?.payload.window).toEqual({ minC: 80, maxC: 100 });
  });

  it('does not fire while tyres stay cold', () => {
    expect(
      run([
        frame({ tempsC: [60, 60, 60, 60], monotonicMs: 0 }),
        frame({ tempsC: [70, 70, 70, 70], monotonicMs: 1000 }), // warmer but still below window
      ]),
    ).toHaveLength(0);
  });

  it('does not fire when tyres were never cold (no edge to cross)', () => {
    expect(
      run([
        frame({ tempsC: [85, 85, 85, 85], monotonicMs: 0 }),
        frame({ tempsC: [88, 88, 88, 88], monotonicMs: 1000 }),
      ]),
    ).toHaveLength(0);
  });

  it('fires only once across a sustained in-window arc (edge, not level)', () => {
    const events = run([
      frame({ tempsC: [60, 60, 60, 60], monotonicMs: 0 }),
      frame({ tempsC: [85, 85, 85, 85], monotonicMs: 1000 }), // recovered → 1 event
      frame({ tempsC: [88, 88, 88, 88], monotonicMs: 2000 }), // still warm → no repeat
    ]);
    expect(events).toHaveLength(1);
  });

  it('is suppressed outside the race phase and in the pit lane', () => {
    expect(
      run([
        frame({ tempsC: [60, 60, 60, 60], monotonicMs: 0, phase: 'formation' }),
        frame({ tempsC: [85, 85, 85, 85], monotonicMs: 1000, phase: 'formation' }),
      ]),
    ).toHaveLength(0);
    expect(
      run([
        frame({ tempsC: [60, 60, 60, 60], monotonicMs: 0 }),
        frame({ tempsC: [85, 85, 85, 85], monotonicMs: 1000, inPitLane: true }),
      ]),
    ).toHaveLength(0);
  });
});
