import { SetupSummarySchema } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import { diffSetups, parseSvm, setupSummaryFromSvm } from '../setup/svm';

/**
 * The exact `.svm` section/key names are LIVE-VERIFY (docs/03 §S4.2) — this sample uses the
 * documented INI shape (`[SECTION]`, `Key=<index>//<display>`). Confirm the real LMU names on the rig.
 */
const SAMPLE = `// Le Mans Ultimate setup export
[GENERAL]
Symmetric=1//Symmetric
FuelSetting=42//100 %

[FRONTLEFT]
Camber=12//-3.5 deg
Pressure=8//27.5 psi

[REARWING]
WingSetting=6//P6
NoComment=3
`;

describe('parseSvm', () => {
  it('parses sections and Key=index//display entries', () => {
    const { sections } = parseSvm(SAMPLE);
    expect(Object.keys(sections)).toEqual(['GENERAL', 'FRONTLEFT', 'REARWING']);
    const camber = sections['FRONTLEFT']!.find((e) => e.key === 'Camber')!;
    expect(camber).toEqual({ key: 'Camber', index: 12, display: '-3.5 deg', raw: '12' });
  });

  it('captures the stored index and the display comment separately', () => {
    const fuel = parseSvm(SAMPLE).sections['GENERAL']!.find((e) => e.key === 'FuelSetting')!;
    expect(fuel.index).toBe(42);
    expect(fuel.display).toBe('100 %');
  });

  it('handles an entry with no //comment (display null, index parsed)', () => {
    const e = parseSvm(SAMPLE).sections['REARWING']!.find((x) => x.key === 'NoComment')!;
    expect(e).toEqual({ key: 'NoComment', index: 3, display: null, raw: '3' });
  });

  it('is tolerant: skips blank lines, comment lines, and malformed entries', () => {
    const { sections } = parseSvm(
      '[A]\n\n// a note\nGood=1//ok\ngarbage line no equals\n;another comment\n',
    );
    expect(sections['A']).toEqual([{ key: 'Good', index: 1, display: 'ok', raw: '1' }]);
  });

  it('reads a non-numeric value as index null, keeping the raw token', () => {
    const e = parseSvm('[A]\nName=Hard//compound\n').sections['A']![0]!;
    expect(e.index).toBeNull();
    expect(e.raw).toBe('Hard');
    expect(e.display).toBe('compound');
  });
});

describe('setupSummaryFromSvm', () => {
  it('flattens to canonical SECTION.Key params (display preferred), schema-valid', () => {
    const summary = setupSummaryFromSvm(SAMPLE, 'Author_Q_GT3');
    expect(summary.name).toBe('Author_Q_GT3');
    expect(summary.params['FRONTLEFT.Camber']).toBe('-3.5 deg');
    expect(summary.params['REARWING.WingSetting']).toBe('P6');
    expect(summary.params['REARWING.NoComment']).toBe(3); // no display → the index
    expect(SetupSummarySchema.safeParse(summary).success).toBe(true);
  });
});

describe('diffSetups', () => {
  it('reports which setting indices changed between two setups (docs/03 §S4.2 reliable use)', () => {
    const base = parseSvm('[FL]\nCamber=12//-3.5\nPressure=8//27.5\n');
    const changed = parseSvm('[FL]\nCamber=14//-2.5\nPressure=8//27.5\n');
    const deltas = diffSetups(base, changed);
    expect(deltas).toEqual([{ section: 'FL', key: 'Camber', from: 12, to: 14 }]);
  });

  it('reports a key present in only one setup with the missing side null', () => {
    const base = parseSvm('[FL]\nCamber=12\n');
    const other = parseSvm('[FL]\nCamber=12\nToe=4\n');
    expect(diffSetups(base, other)).toEqual([{ section: 'FL', key: 'Toe', from: null, to: 4 }]);
  });

  it('is empty when nothing changed', () => {
    const a = parseSvm('[FL]\nCamber=12//-3.5\n');
    const b = parseSvm('[FL]\nCamber=12//note text differs but index same\n');
    expect(diffSetups(a, b)).toEqual([]); // index unchanged → no delta (display is not a setting change)
  });
});
