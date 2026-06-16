import { describe, expect, it } from 'vitest';
import { EventDetector, tireTempRule } from '../events';
import type { EngineerEvent, RaceState, Tire } from '../schema';
import { makeTire, raceStartState } from '../fixtures';

const frame = (opts: {
  tempsC: [number, number, number, number];
  monotonicMs?: number;
  inPitLane?: boolean;
}): RaceState => ({
  ...raceStartState,
  tick: opts.monotonicMs ?? 0,
  monotonicMs: opts.monotonicMs ?? 0,
  player: {
    ...raceStartState.player,
    tires: opts.tempsC.map((c) => makeTire({ tempC: c })) as [Tire, Tire, Tire, Tire],
    pit: { ...raceStartState.player.pit, inPitLane: opts.inPitLane ?? false },
  },
});

const run = (frames: RaceState[]): EngineerEvent[] => {
  const detector = new EventDetector([tireTempRule()]);
  return frames.flatMap((f) => detector.process(f));
};

describe('tireTempRule', () => {
  it('fires "hot" when a tyre is above the window, naming the worst corner', () => {
    const events = run([frame({ tempsC: [90, 90, 105, 112] })]); // RL/RR overheating
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('tire_temp_out_of_window');
    expect(events[0]?.payload.direction).toBe('hot');
    expect(events[0]?.payload.corners).toEqual(['RL', 'RR']);
    expect(events[0]?.payload.tempC).toBe(112); // worst (hottest)
  });

  it('fires "cold" when a tyre is below the window', () => {
    const events = run([frame({ tempsC: [60, 90, 90, 90] })]);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.direction).toBe('cold');
    expect(events[0]?.payload.corners).toEqual(['FL']);
    expect(events[0]?.payload.tempC).toBe(60);
  });

  it('is silent when every tyre is inside the window', () => {
    expect(run([frame({ tempsC: [85, 90, 95, 88] })])).toHaveLength(0);
  });

  it('is suppressed in the pit lane (cold tyres there are expected)', () => {
    expect(run([frame({ tempsC: [50, 50, 50, 50], inPitLane: true })])).toHaveLength(0);
  });

  it('emits both a hot and a cold event when corners differ', () => {
    const events = run([frame({ tempsC: [60, 90, 90, 110] })]); // FL cold, RR hot
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.payload.direction))).toEqual(new Set(['hot', 'cold']));
    expect(new Set(events.map((e) => e.dedupeKey))).toEqual(
      new Set(['tire_temp_out_of_window:hot', 'tire_temp_out_of_window:cold']),
    );
  });

  it('fires once over a sustained out-of-window arc (cooldown)', () => {
    const frames = [0, 1000, 2000, 30_000].map((ms) =>
      frame({ tempsC: [110, 110, 110, 110], monotonicMs: ms }),
    );
    const hot = run(frames).filter((e) => e.payload.direction === 'hot');
    expect(hot).toHaveLength(1); // 60 s cooldown not yet elapsed across the arc
  });

  it('re-fires after the cooldown elapses', () => {
    const frames = [0, 61_000].map((ms) =>
      frame({ tempsC: [110, 110, 110, 110], monotonicMs: ms }),
    );
    expect(run(frames).filter((e) => e.payload.direction === 'hot')).toHaveLength(2);
  });
});
