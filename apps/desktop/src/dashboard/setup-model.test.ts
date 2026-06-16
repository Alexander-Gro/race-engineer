import { multiClassTrafficState, raceStartState } from '@race-engineer/core/fixtures';
import type { RaceState, SetupSummary } from '@race-engineer/core';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import { describe, expect, it } from 'vitest';
import { buildSetupModel } from './setup-model';

const snap = (raceState: RaceState, seq = 1): EngineerSnapshot => ({
  seq,
  monotonicMs: raceState.monotonicMs,
  raceState,
});

const aid = (m: ReturnType<typeof buildSetupModel>, label: string) =>
  m.aids.find((a) => a.label === label)!;

describe('buildSetupModel — aid baseline', () => {
  it('surfaces TC/ABS with their valid range from the schema', () => {
    // multiClassTrafficState fixtures populate aids (tc/abs with min/max).
    const m = buildSetupModel(snap(multiClassTrafficState));
    const tc = aid(m, 'Traction control');
    expect(tc.value.severity).toBe('neutral');
    expect(tc.range).toMatch(/^\d+–\d+$/); // "min–max"
  });

  it('shows brake bias as a % and leaves car-data-only ranges as —', () => {
    const m = buildSetupModel(snap(multiClassTrafficState));
    expect(aid(m, 'Brake bias (front)').value.value).toMatch(/%$/);
    expect(aid(m, 'Brake bias (front)').range).toBe('—'); // safe range is car data (rig)
    expect(aid(m, 'Engine map').range).toBe('—');
  });

  it('renders an unread aid as —/unknown, never a fabricated value', () => {
    const noAids: RaceState = {
      ...raceStartState,
      player: {
        ...raceStartState.player,
        aids: { tc: null, abs: null, brakeBias: { frontPct: null } },
        engine: { ...raceStartState.player.engine, map: null },
      },
    };
    const m = buildSetupModel(snap(noAids));
    expect(aid(m, 'Traction control').value).toEqual({ value: '—', severity: 'unknown' });
    expect(aid(m, 'Traction control').range).toBe('—'); // no min/max either
    expect(aid(m, 'Brake bias (front)').value).toEqual({ value: '—', severity: 'unknown' });
  });
});

describe('buildSetupModel — loaded setup params', () => {
  const setup: SetupSummary = {
    name: 'Author_Q_GT3',
    params: {
      'GENERAL.FuelSetting': '100 %',
      'FRONTLEFT.Camber': '-3.5 deg',
      'FRONTLEFT.Pressure': '27.5 psi',
      'REARWING.WingSetting': 'P6',
      Symmetric: 1, // a key with no section
    },
  };
  const withSetup: RaceState = {
    ...multiClassTrafficState,
    player: { ...multiClassTrafficState.player, setupSummary: setup },
  };

  it('reports no setup honestly when none is loaded', () => {
    const m = buildSetupModel(snap(multiClassTrafficState)); // fixture has setupSummary: null
    expect(m.hasSetup).toBe(false);
    expect(m.setupName).toBeNull();
    expect(m.sections).toEqual([]);
  });

  it('groups params by .svm section, preserving order, with the name', () => {
    const m = buildSetupModel(snap(withSetup));
    expect(m.hasSetup).toBe(true);
    expect(m.setupName).toBe('Author_Q_GT3');
    expect(m.sections.map((s) => s.section)).toEqual(['GENERAL', 'FRONTLEFT', 'REARWING', '']);
    const fl = m.sections.find((s) => s.section === 'FRONTLEFT')!;
    expect(fl.rows).toEqual([
      { key: 'Camber', value: '-3.5 deg' },
      { key: 'Pressure', value: '27.5 psi' },
    ]);
  });

  it('formats a section-less key and a numeric value', () => {
    const m = buildSetupModel(snap(withSetup));
    const root = m.sections.find((s) => s.section === '')!;
    expect(root.rows).toEqual([{ key: 'Symmetric', value: '1' }]);
  });

  it('carries the snapshot seq', () => {
    expect(buildSetupModel(snap(withSetup, 7)).seq).toBe(7);
  });
});
