import { describe, expect, it } from 'vitest';
import { energyLowRule, EventDetector, fuelLowRule, lapCompletedRule } from '../events';
import type { EventRule } from '../events';
import type { EngineerEvent, RaceState } from '../schema';
import { raceStartState } from '../fixtures';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface FrameOverrides {
  tick?: number;
  monotonicMs?: number;
  lapsCompleted?: number;
  lapsRemainingEst?: number | null;
  /** When set, populates player.virtualEnergy with this VE laps-remaining (for energyLowRule). */
  energyLapsRemaining?: number;
}

const frame = (overrides: FrameOverrides): RaceState => {
  const f: RaceState = clone(raceStartState);
  if (overrides.tick !== undefined) f.tick = overrides.tick;
  if (overrides.monotonicMs !== undefined) f.monotonicMs = overrides.monotonicMs;
  if (overrides.lapsCompleted !== undefined) f.player.lapsCompleted = overrides.lapsCompleted;
  if (overrides.lapsRemainingEst !== undefined) {
    f.player.fuel.lapsRemainingEst = overrides.lapsRemainingEst;
  }
  if (overrides.energyLapsRemaining !== undefined) {
    f.player.virtualEnergy = {
      level01: 0.5,
      perLapAvg01: 0.05,
      lapsRemainingEst: overrides.energyLapsRemaining,
    };
  }
  return f;
};

describe('lapCompletedRule', () => {
  it('fires once per lap increment, never on the first frame', () => {
    const detector = new EventDetector([lapCompletedRule()]);
    const first = detector.process(frame({ tick: 0, lapsCompleted: 0 })); // no prev
    const inc1 = detector.process(frame({ tick: 1, lapsCompleted: 1 })); // 0 -> 1
    const same = detector.process(frame({ tick: 2, lapsCompleted: 1 })); // no change
    const inc2 = detector.process(frame({ tick: 3, lapsCompleted: 2 })); // 1 -> 2

    expect(first).toHaveLength(0);
    expect(inc1).toHaveLength(1);
    expect(inc1[0]?.type).toBe('lap_completed');
    expect(inc1[0]?.tier).toBe(1);
    expect(inc1[0]?.payload.lap).toBe(1);
    expect(same).toHaveLength(0);
    expect(inc2).toHaveLength(1);
  });
});

describe('EventDetector cooldown', () => {
  it('suppresses repeats within the cooldown window and re-fires after', () => {
    const pulse: EventRule = {
      name: 'pulse',
      detect: () => [
        { type: 'fuel_low', tier: 1, priority: 5, payload: {}, dedupeKey: 'k', cooldownMs: 1000 },
      ],
    };
    const detector = new EventDetector([pulse]);

    expect(detector.process(frame({ monotonicMs: 0 }))).toHaveLength(1); // first -> emit
    expect(detector.process(frame({ monotonicMs: 500 }))).toHaveLength(0); // within cooldown
    expect(detector.process(frame({ monotonicMs: 1000 }))).toHaveLength(1); // cooldown elapsed
    expect(detector.process(frame({ monotonicMs: 1200 }))).toHaveLength(0); // within new cooldown
  });
});

describe('fuelLowRule', () => {
  it('a synthetic fuel-low arc fires exactly one event (cooldown)', () => {
    const detector = new EventDetector([
      fuelLowRule({
        thresholds: [{ lapsRemaining: 2, tier: 1, priority: 8, cooldownMs: 600_000 }],
      }),
    ]);
    const emitted: EngineerEvent[] = [];
    // laps-remaining descends past the 2-lap threshold and stays below it
    const arc = [5, 4, 3, 2.5, 1.8, 1.4, 1.0, 0.6];
    arc.forEach((laps, i) => {
      emitted.push(
        ...detector.process(
          frame({ tick: i, monotonicMs: i * 1000, lapsCompleted: 10, lapsRemainingEst: laps }),
        ),
      );
    });

    const fuelLow = emitted.filter((e) => e.type === 'fuel_low');
    expect(fuelLow).toHaveLength(1);
    expect(fuelLow[0]?.tier).toBe(1);
    expect(Number(fuelLow[0]?.payload.lapsRemaining)).toBeLessThan(2);
  });

  it('does not fire when laps-remaining is unknown (null)', () => {
    const detector = new EventDetector([
      fuelLowRule({ thresholds: [{ lapsRemaining: 2, tier: 1, priority: 8, cooldownMs: 1000 }] }),
    ]);
    expect(detector.process(frame({ lapsRemainingEst: null }))).toHaveLength(0);
  });

  it('escalates across multiple thresholds as fuel falls', () => {
    const detector = new EventDetector([fuelLowRule()]); // defaults: 4 laps then 2 laps
    const emitted: EngineerEvent[] = [];
    [5, 3.5, 2.5, 1.5].forEach((laps, i) => {
      emitted.push(
        ...detector.process(frame({ tick: i, monotonicMs: i * 1000, lapsRemainingEst: laps })),
      );
    });

    const fuelLow = emitted.filter((e) => e.type === 'fuel_low');
    expect(fuelLow).toHaveLength(2); // crossing 4 fires once, crossing 2 fires once
    expect(new Set(fuelLow.map((e) => e.dedupeKey)).size).toBe(2); // distinct threshold keys
  });
});

describe('energyLowRule (Virtual Energy sibling of fuelLowRule)', () => {
  it('a synthetic VE-low arc fires exactly one event (cooldown)', () => {
    const detector = new EventDetector([
      energyLowRule({
        thresholds: [{ lapsRemaining: 2, tier: 1, priority: 8, cooldownMs: 600_000 }],
      }),
    ]);
    const emitted: EngineerEvent[] = [];
    const arc = [5, 4, 3, 2.5, 1.8, 1.4, 1.0, 0.6];
    arc.forEach((laps, i) => {
      emitted.push(
        ...detector.process(
          frame({ tick: i, monotonicMs: i * 1000, lapsCompleted: 10, energyLapsRemaining: laps }),
        ),
      );
    });

    const energyLow = emitted.filter((e) => e.type === 'energy_low');
    expect(energyLow).toHaveLength(1);
    expect(energyLow[0]?.tier).toBe(1);
    expect(Number(energyLow[0]?.payload.lapsRemaining)).toBeLessThan(2);
  });

  it('stays silent when the source exposes no Virtual Energy (null)', () => {
    const detector = new EventDetector([
      energyLowRule({ thresholds: [{ lapsRemaining: 2, tier: 1, priority: 8, cooldownMs: 1000 }] }),
    ]);
    // No energyLapsRemaining override → player.virtualEnergy stays null (fixture default).
    expect(detector.process(frame({ lapsRemainingEst: 1 }))).toHaveLength(0);
  });

  it('escalates across multiple thresholds as VE falls', () => {
    const detector = new EventDetector([energyLowRule()]); // defaults: 4 laps then 2 laps
    const emitted: EngineerEvent[] = [];
    [5, 3.5, 2.5, 1.5].forEach((laps, i) => {
      emitted.push(
        ...detector.process(frame({ tick: i, monotonicMs: i * 1000, energyLapsRemaining: laps })),
      );
    });

    const energyLow = emitted.filter((e) => e.type === 'energy_low');
    expect(energyLow).toHaveLength(2);
    expect(new Set(energyLow.map((e) => e.dedupeKey)).size).toBe(2);
  });
});
