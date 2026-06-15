import { midStintState } from '@race-engineer/core/fixtures';
import type { RaceState } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import {
  AdviceWatcher,
  changeSatisfied,
  classifyAdvice,
  readAidParameter,
  type ProposedChange,
} from '../advice';

/** A valid RaceState (cloned from a fixture) with a chosen TC value + telemetry time. */
const tcState = (value: number | null, monotonicMs: number): RaceState => {
  const s = structuredClone(midStintState) as RaceState;
  s.monotonicMs = monotonicMs;
  s.player.aids.tc = value === null ? null : { value, min: 0, max: 11 };
  return s;
};

const biasState = (frontPct: number | null, monotonicMs: number): RaceState => {
  const s = structuredClone(midStintState) as RaceState;
  s.monotonicMs = monotonicMs;
  s.player.aids.brakeBias.frontPct = frontPct;
  return s;
};

describe('readAidParameter', () => {
  it('reads each aid, and returns null when the game does not expose it', () => {
    const s = structuredClone(midStintState) as RaceState;
    s.player.aids.tc = { value: 4, min: 0, max: 11 };
    s.player.aids.abs = null;
    s.player.aids.brakeBias.frontPct = 54.5;
    s.player.engine.map = 6;
    expect(readAidParameter(s, 'tc')).toBe(4);
    expect(readAidParameter(s, 'abs')).toBeNull();
    expect(readAidParameter(s, 'brakeBias')).toBe(54.5);
    expect(readAidParameter(s, 'engineMap')).toBe(6);
  });
});

describe('changeSatisfied / classifyAdvice (pure)', () => {
  it('matches an exact target within tolerance', () => {
    expect(changeSatisfied({ parameter: 'tc', from: 3, to: 5 }, 5)).toBe(true);
    expect(changeSatisfied({ parameter: 'tc', from: 3, to: 5 }, 4)).toBe(false);
    expect(
      changeSatisfied({ parameter: 'brakeBias', from: 54.5, to: 52.5, toleranceAbs: 0.3 }, 52.6),
    ).toBe(true);
  });

  it('matches a direction off the baseline', () => {
    expect(changeSatisfied({ parameter: 'tc', from: 3, direction: 'increase' }, 4)).toBe(true);
    expect(changeSatisfied({ parameter: 'tc', from: 3, direction: 'increase' }, 3)).toBe(false);
    expect(changeSatisfied({ parameter: 'brakeBias', from: 54, direction: 'decrease' }, 53)).toBe(
      true,
    );
  });

  it('is unsatisfiable with neither target nor direction', () => {
    expect(changeSatisfied({ parameter: 'tc', from: 3 }, 9)).toBe(false);
  });

  it('classifies applied / unchanged / timeout around the window', () => {
    const change: ProposedChange = { parameter: 'tc', from: 3, to: 5 };
    expect(classifyAdvice(change, 5, 1000, 5000)).toBe('applied'); // reached target, mid-window
    expect(classifyAdvice(change, 3, 1000, 5000)).toBe('watching'); // still baseline, mid-window
    expect(classifyAdvice(change, 3, 5000, 5000)).toBe('unchanged'); // baseline at the deadline
    expect(classifyAdvice(change, 4, 5000, 5000)).toBe('timeout'); // moved, but not as advised
    expect(classifyAdvice(change, null, 5000, 5000)).toBe('timeout'); // unreadable past the window
  });
});

describe('AdviceWatcher', () => {
  it("confirms 'applied' when the driver reaches the advised TC", () => {
    const w = new AdviceWatcher({ parameter: 'tc', from: 3, to: 5 });
    expect(w.update(tcState(3, 0))).toBe('watching');
    expect(w.update(tcState(3, 1000))).toBe('watching');
    expect(w.update(tcState(5, 2000))).toBe('applied');
  });

  it("confirms a directional change ('bias back' ⇒ frontPct decreases)", () => {
    const w = new AdviceWatcher({ parameter: 'brakeBias', from: 54, direction: 'decrease' });
    expect(w.update(biasState(54, 0))).toBe('watching');
    expect(w.update(biasState(52, 1500))).toBe('applied'); // moved rearward
  });

  it("reports 'unchanged' when the driver never acts within the window", () => {
    const w = new AdviceWatcher({ parameter: 'tc', from: 3, to: 5 }, { timeoutMs: 5000 });
    expect(w.update(tcState(3, 0))).toBe('watching');
    expect(w.update(tcState(3, 6000))).toBe('unchanged');
  });

  it("reports 'timeout' when the value moved but not as advised", () => {
    const w = new AdviceWatcher({ parameter: 'tc', from: 3, to: 5 }, { timeoutMs: 5000 });
    w.update(tcState(3, 0));
    expect(w.update(tcState(4, 6000))).toBe('timeout');
  });

  it("reports 'timeout' when the aid can't be read at all (live values pending S3)", () => {
    const w = new AdviceWatcher({ parameter: 'tc', from: 3, to: 5 }, { timeoutMs: 5000 });
    expect(w.update(tcState(null, 0))).toBe('watching');
    expect(w.update(tcState(null, 6000))).toBe('timeout');
  });

  it('is sticky once resolved — a later revert does not un-confirm', () => {
    const w = new AdviceWatcher({ parameter: 'tc', from: 3, to: 5 });
    expect(w.update(tcState(5, 2000))).toBe('applied');
    expect(w.update(tcState(3, 3000))).toBe('applied'); // reverting is a new advice cycle, not this one
  });

  it('only ever transitions watching → a terminal status, and never throws', () => {
    const w = new AdviceWatcher({ parameter: 'tc', from: 3, to: 5 }, { timeoutMs: 5000 });
    const seen = new Set<string>();
    let prevTerminal = false;
    for (let t = 0; t <= 8000; t += 1000) {
      const value = t < 4000 ? 3 : 5; // driver acts at t=4000
      const status = w.update(tcState(value, t));
      seen.add(status);
      if (prevTerminal) expect(status).toBe('applied'); // terminal status is sticky
      if (status !== 'watching') prevTerminal = true;
    }
    expect(seen.has('applied')).toBe(true);
  });
});
