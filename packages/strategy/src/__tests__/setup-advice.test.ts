import { describe, expect, it } from 'vitest';
import type { Tire } from '@race-engineer/core';
import { diagnoseHandling } from '../handling';
import { proposeSetupChanges } from '../setup-advice';

const zone = (inner: number, center: number, outer: number): Tire => ({
  tempC: { inner, center, outer },
  pressureKpa: null,
  wear01: null,
  compound: null,
  surfaceTempC: null,
});

const advise = (tires: Tire[]) => proposeSetupChanges(diagnoseHandling(tires));

describe('proposeSetupChanges', () => {
  it('advises freeing the front for understeer (fronts hotter)', () => {
    const hot = zone(100, 100, 100);
    const cool = zone(82, 82, 82);
    const out = advise([hot, hot, cool, cool]);
    expect(out[0]?.area).toBe('balance');
    expect(out[0]?.change).toMatch(/front/i);
    expect(out[0]?.reason).toMatch(/understeer/);
  });

  it('advises steadying the rear for oversteer (rears hotter)', () => {
    const hot = zone(100, 100, 100);
    const cool = zone(82, 82, 82);
    const out = advise([cool, cool, hot, hot]);
    expect(out[0]?.area).toBe('balance');
    expect(out[0]?.change).toMatch(/rear/i);
    expect(out[0]?.reason).toMatch(/oversteer/);
  });

  it('returns nothing to change when the balance is neutral and tyres are even', () => {
    const even = zone(90, 90, 90);
    expect(advise([even, even, even, even])).toEqual([]);
  });

  it('advises lowering pressure on an over-inflated corner (centre hot)', () => {
    const over = zone(85, 100, 85); // centre >> edges → over-inflated
    const even = zone(90, 90, 90);
    const out = advise([over, even, even, even]);
    const pressure = out.find((s) => s.area === 'tyre pressure');
    expect(pressure?.change).toMatch(/lower the front-left tyre pressure/i);
  });

  it('advises reducing negative camber on an inner-hot corner', () => {
    const cambered = zone(102, 92, 84); // inner − outer = 18 → inner-hot
    const even = zone(90, 90, 90);
    const out = advise([cambered, even, even, even]);
    const camber = out.find((s) => s.area === 'camber');
    expect(camber?.change).toMatch(/reduce negative camber on the front-left/i);
  });

  it('carries the diagnosis confidence on every suggestion', () => {
    const hot = zone(100, 100, 100);
    const cool = zone(82, 82, 82);
    const out = advise([hot, hot, cool, cool]);
    expect(out.every((s) => s.confidence01 === 1)).toBe(true); // 4/4 corners have 3-zone data
  });

  it('orders balance first, then pressure, then camber', () => {
    const hotOverCambered = zone(110, 120, 95); // hot (balance), centre-hot (pressure), inner-hot (camber)
    const cool = zone(82, 82, 82);
    const areas = advise([hotOverCambered, cool, cool, cool]).map((s) => s.area);
    expect(areas[0]).toBe('balance');
    expect(areas.indexOf('tyre pressure')).toBeLessThan(areas.lastIndexOf('camber'));
  });
});
