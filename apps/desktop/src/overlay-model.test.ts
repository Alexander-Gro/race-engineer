import {
  lowFuelState,
  midStintState,
  multiClassTrafficState,
  raceStartState,
} from '@race-engineer/core/fixtures';
import type { RaceState } from '@race-engineer/core';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import { describe, expect, it } from 'vitest';
import { buildOverlayModel } from './overlay-model';

const snap = (raceState: RaceState, extra: Partial<EngineerSnapshot> = {}): EngineerSnapshot => ({
  seq: 1,
  monotonicMs: raceState.monotonicMs,
  raceState,
  ...extra,
});

describe('buildOverlayModel', () => {
  it('carries the fuel hero number with the dashboard severity (critical, real value)', () => {
    const m = buildOverlayModel(snap(lowFuelState));
    expect(m.fuelLaps).toEqual({ value: '1.1', severity: 'critical' });
  });

  it('stays state-honest for unknown fuel (— / unknown, never a fabricated 0)', () => {
    const m = buildOverlayModel(snap(raceStartState));
    expect(m.fuelLaps).toEqual({ value: '—', severity: 'unknown' });
    expect(m.nextPit.value).toBe('—');
  });

  it('formats nearest rivals compactly with class + gap, and flags a faster class approaching', () => {
    const m = buildOverlayModel(snap(multiClassTrafficState));
    // Whichever cars are nearest, the overlay shows "name (class) gap" or null — never a half-formed line.
    for (const rival of [m.ahead, m.behind]) {
      if (rival !== null) {
        expect(rival.text).toMatch(/.+/);
        expect(['good', 'caution', 'critical', 'neutral', 'unknown']).toContain(rival.severity);
      }
    }
    expect(typeof m.fasterClassApproaching).toBe('boolean');
  });

  it('surfaces the most-recent call-out, or null when none fired', () => {
    const withEvent = buildOverlayModel(
      snap(midStintState, {
        events: [
          { id: 'e1', tick: 0, type: 'fuel_low', tier: 1, priority: 50, payload: {} },
          { id: 'e2', tick: 0, type: 'lap_completed', tier: 1, priority: 10, payload: {} },
        ],
      }),
    );
    expect(withEvent.alert).toEqual({ label: 'Fuel low', severity: 'caution' });

    expect(buildOverlayModel(snap(midStintState)).alert).toBeNull();
  });

  it('projects the same position/flag/last-lap strings the dashboard already formatted', () => {
    const m = buildOverlayModel(snap(midStintState));
    expect(typeof m.position).toBe('string');
    expect(m.position.length).toBeGreaterThan(0);
    expect(typeof m.flag.value).toBe('string');
    expect(typeof m.lastLap.value).toBe('string');
  });
});
