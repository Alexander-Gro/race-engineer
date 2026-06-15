import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractSetupBaseline, parseSvm, parseSvmFile, toSetupSummary } from '../setup/svm';

const FIXTURE = fileURLToPath(new URL('../../fixtures/sample-gt3.svm', import.meta.url));

const SAMPLE = `VehicleClassSetting="GT3 Sample_GT3_Car WEC2025"
UpgradeSetting=(299140,0,0,0)
//VEH=C:\\Games\\LMU\\sample.VEH

[GENERAL]
Notes=""
FuelSetting=83//0.84
WedgeSetting=0//N/A

[DRIVING AIDS]
BrakeMigrationSetting=0// 0.0
TractionControlMapSetting=5//5
AntilockBrakeSystemMapSetting=9//9 (Understeer)
EngineMixtureSetting=1//Race

[FRONTLEFT]
CompoundSetting=0//Medium
[REARRIGHT]
CompoundSetting=0//Medium
`;

describe('parseSvm', () => {
  it('reads the header (vehicle class + VEH path)', () => {
    const svm = parseSvm(SAMPLE);
    expect(svm.vehicleClass).toBe('GT3 Sample_GT3_Car WEC2025');
    expect(svm.vehPath).toBe('C:\\Games\\LMU\\sample.VEH');
  });

  it('parses index values as numbers and keeps the display comment', () => {
    const svm = parseSvm(SAMPLE);
    const abs = svm.entries.find((e) => e.key === 'AntilockBrakeSystemMapSetting');
    expect(abs).toEqual({
      section: 'DRIVING AIDS',
      key: 'AntilockBrakeSystemMapSetting',
      value: 9,
      display: '9 (Understeer)',
    });
  });

  it('assigns each entry to its section and trims display comments', () => {
    const svm = parseSvm(SAMPLE);
    const mig = svm.entries.find((e) => e.key === 'BrakeMigrationSetting');
    expect(mig?.section).toBe('DRIVING AIDS');
    expect(mig?.display).toBe('0.0'); // the leading space in `// 0.0` is trimmed
  });

  it('keeps quoted strings and (tuple) values verbatim, and null display when no comment', () => {
    const svm = parseSvm(SAMPLE);
    expect(svm.entries.find((e) => e.key === 'Notes')?.value).toBe('');
    const upgrade = svm.entries.find((e) => e.key === 'UpgradeSetting');
    expect(upgrade?.value).toBe('(299140,0,0,0)');
    expect(upgrade?.display).toBeNull();
  });

  it('never throws on malformed / junk lines — it skips them', () => {
    const svm = parseSvm('garbage line\n[X]\n=novalue\nKey\nGood=7//ok\n');
    expect(svm.entries).toEqual([{ section: 'X', key: 'Good', value: 7, display: 'ok' }]);
  });
});

describe('extractSetupBaseline', () => {
  it('pulls the aid/strategy fields with index + display', () => {
    const base = extractSetupBaseline(parseSvm(SAMPLE));
    expect(base.tractionControlMap?.value).toBe(5);
    expect(base.absMap?.display).toBe('9 (Understeer)');
    expect(base.engineMixture).toMatchObject({ value: 1, display: 'Race' });
    expect(base.fuel?.value).toBe(83);
    expect(base.compounds).toHaveLength(2);
    expect(base.compounds.every((c) => c.display === 'Medium')).toBe(true);
  });
});

describe('toSetupSummary (canonical SetupSummary)', () => {
  it('flattens entries to a key->index params map under the given name', () => {
    const summary = toSetupSummary(parseSvm(SAMPLE), 'Race Balanced');
    expect(summary.name).toBe('Race Balanced');
    expect(summary.params['TractionControlMapSetting']).toBe(5);
    expect(summary.params['EngineMixtureSetting']).toBe(1);
  });
});

describe('parseSvmFile (read-only file read)', () => {
  it('reads + parses a real-shaped .svm fixture from disk', () => {
    const base = extractSetupBaseline(parseSvmFile(FIXTURE));
    expect(base.vehicleClass).toBe('GT3 Sample_GT3_Car WEC2025');
    expect(base.tractionControlMap?.value).toBe(5);
    expect(base.absMap?.display).toBe('9 (Understeer)');
    expect(base.engineMixture?.display).toBe('Race');
    expect(base.virtualEnergy?.display).toBe('100% (10.7 laps)');
    expect(base.compounds).toHaveLength(4); // four corners in the fixture
  });
});
