import { describe, expect, it } from 'vitest';
import { evaluateFcyStop, fcyPitLoss, type FcyStopInput } from '../fcy';

describe('fcyPitLoss', () => {
  it('scales the green pit-loss by the caution pace fraction (worked example: 47 × 0.4)', () => {
    const r = fcyPitLoss({ greenPitLossS: 47, cautionPaceFraction: 0.4 });
    expect(r.cautionPitLossS).toBeCloseTo(18.8, 6);
    expect(r.savedS).toBeCloseTo(28.2, 6);
  });

  it('spans the full range: fraction 0 saves everything, 1 saves nothing', () => {
    expect(fcyPitLoss({ greenPitLossS: 47, cautionPaceFraction: 0 }).savedS).toBeCloseTo(47, 6);
    expect(fcyPitLoss({ greenPitLossS: 47, cautionPaceFraction: 1 }).savedS).toBe(0);
  });

  it('clamps the fraction and a negative pit-loss', () => {
    expect(fcyPitLoss({ greenPitLossS: 47, cautionPaceFraction: 2 }).cautionPitLossS).toBe(47);
    expect(fcyPitLoss({ greenPitLossS: -5, cautionPaceFraction: 0.5 }).savedS).toBe(0);
  });
});

describe('evaluateFcyStop', () => {
  const base: FcyStopInput = {
    greenPitLossS: 47,
    cautionPaceFraction: 0.4,
    underCaution: true,
    lapsUntilPlannedStop: 2,
  };

  it("recommends 'box_now' under caution when a cheap stop is due soon (docs/05 §7)", () => {
    const d = evaluateFcyStop(base);
    expect(d.recommend).toBe('box_now');
    expect(d.savedS).toBeCloseTo(28.2, 6);
    expect(d.cautionPitLossS).toBeCloseTo(18.8, 6);
    expect(d.reason).toMatch(/box now/i);
    expect(d.reason).toContain('due in 2');
  });

  it('stays out when there is no caution (normal pit-loss applies)', () => {
    expect(evaluateFcyStop({ ...base, underCaution: false }).recommend).toBe('stay_out');
  });

  it('stays out when the caution is barely cheaper than green', () => {
    // fraction 0.95 → save only 47×0.05 = 2.35 s, below the 5 s floor.
    const d = evaluateFcyStop({ ...base, cautionPaceFraction: 0.95 });
    expect(d.recommend).toBe('stay_out');
    expect(d.reason).toMatch(/barely cheaper/i);
  });

  it('stays out when the cheap stop is not due for many laps', () => {
    const d = evaluateFcyStop({ ...base, lapsUntilPlannedStop: 15 });
    expect(d.recommend).toBe('stay_out');
    expect(d.reason).toMatch(/not due/i);
  });

  it('boxes to serve an outstanding mandatory stop even when not otherwise due', () => {
    const d = evaluateFcyStop({
      ...base,
      lapsUntilPlannedStop: null,
      mandatoryStopDue: true,
    });
    expect(d.recommend).toBe('box_now');
    expect(d.reason).toMatch(/mandatory/i);
  });
});

describe('properties', () => {
  it('savedS is in [0, greenPitLoss], decreasing in caution pace; no NaN/Infinity', () => {
    let prev = Infinity;
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const { savedS } = fcyPitLoss({ greenPitLossS: 47, cautionPaceFraction: f });
      expect(savedS).toBeLessThanOrEqual(prev);
      expect(savedS).toBeGreaterThanOrEqual(0);
      expect(savedS).toBeLessThanOrEqual(47);
      expect(Number.isFinite(savedS)).toBe(true);
      prev = savedS;
    }
  });

  it('confidence is passed through, defaulting to 0.6, clamped to [0,1]', () => {
    const at = (confidence01?: number) =>
      evaluateFcyStop({ greenPitLossS: 47, underCaution: false, confidence01 }).confidence01;
    expect(at()).toBe(0.6);
    expect(at(0.9)).toBe(0.9);
    expect(at(2)).toBe(1);
    expect(at(-1)).toBe(0);
  });
});
