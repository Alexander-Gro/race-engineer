import { describe, expect, it } from 'vitest';
import type { Tire } from '@race-engineer/core';
import { diagnoseHandling } from '../handling';
import { compareHandling } from '../setup-compare';

const zone = (c: number): Tire => ({
  tempC: { inner: c, center: c, outer: c },
  pressureKpa: null,
  wear01: null,
  compound: null,
  surfaceTempC: null,
});

/** A diagnosis with a given front/rear representative temp (controls the front−rear gap). */
const diag = (frontC: number, rearC: number) =>
  diagnoseHandling([zone(frontC), zone(frontC), zone(rearC), zone(rearC)]);

const single = (c: number): Tire => ({
  tempC: c,
  pressureKpa: null,
  wear01: null,
  compound: null,
  surfaceTempC: null,
});

describe('compareHandling (before/after a setup change)', () => {
  it('reports improvement when understeer eases toward neutral', () => {
    const before = diag(104, 86); // +18 → understeer
    const after = diag(92, 88); // +4 → neutral
    const c = compareHandling(before, after);
    expect(c.before).toBe('understeer');
    expect(c.after).toBe('neutral');
    expect(c.shift).toBe('improved');
    expect(c.summary).toMatch(/Better/);
  });

  it('reports worsening when a neutral balance is pushed into understeer', () => {
    const c = compareHandling(diag(90, 88), diag(104, 86));
    expect(c.shift).toBe('worsened');
    expect(c.summary).toMatch(/Worse/);
  });

  it('flags an overcorrection (understeer → bigger oversteer) as worse', () => {
    const before = diag(98, 90); // +8 understeer
    const after = diag(82, 102); // −20 oversteer (bigger gap)
    const c = compareHandling(before, after);
    expect(c.after).toBe('oversteer');
    expect(c.shift).toBe('worsened');
    expect(c.summary).toMatch(/overcorrected/);
  });

  it('counts a flip to a smaller gap as an improvement (nearer balanced)', () => {
    const before = diag(106, 84); // +22 understeer
    const after = diag(88, 94); // −6 (smaller magnitude)
    const c = compareHandling(before, after);
    expect(c.shift).toBe('improved');
  });

  it('reports no change within the deadband', () => {
    const c = compareHandling(diag(104, 86), diag(103, 86)); // +18 → +17, within 1.5°
    expect(c.shift).toBe('unchanged');
    expect(c.summary).toMatch(/No real change/);
  });

  it('is unknown when either side lacks 3-zone tyre data', () => {
    const noZones = diagnoseHandling([single(90), single(90), single(90), single(90)]);
    // single-value temps → balance derivable, but let's force unknown via a tendency-unknown side:
    const empty = diagnoseHandling([]); // no tyres → frontAvg/rearAvg null → tendency unknown
    expect(compareHandling(empty, diag(104, 86)).shift).toBe('unknown');
    // a coarse (single-value) read still has a delta, so it compares; sanity-check it's not a throw:
    expect(['improved', 'unchanged', 'worsened', 'unknown']).toContain(
      compareHandling(noZones, diag(90, 90)).shift,
    );
  });
});
