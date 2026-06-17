import { describe, expect, it } from 'vitest';
import { dbToGain, makeDistortionCurve, RADIO_FX_DEFAULTS } from './radio-fx';

describe('radio-fx pure helpers', () => {
  it('dbToGain matches known points', () => {
    expect(dbToGain(0)).toBeCloseTo(1, 10);
    expect(dbToGain(6)).toBeCloseTo(1.995, 2); // +6 dB ≈ ×2
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
  });

  it('makeDistortionCurve is the requested length, bounded, and odd-symmetric', () => {
    const curve = makeDistortionCurve(18, 1024);
    expect(curve).toHaveLength(1024);
    // Spans the input range and stays finite/bounded.
    for (const v of curve) expect(Number.isFinite(v)).toBe(true);
    // Odd symmetry: f(-x) = -f(x) → first ≈ -last.
    expect(curve[0]!).toBeCloseTo(-curve[curve.length - 1]!, 6);
    // The midpoint (x≈0) maps to ≈0.
    expect(Math.abs(curve[Math.floor(curve.length / 2)]!)).toBeLessThan(0.05);
  });

  it('a clean (0) curve is gentler than a driven one at the same input', () => {
    const clean = makeDistortionCurve(0, 1024);
    const driven = makeDistortionCurve(40, 1024);
    const i = Math.floor(1024 * 0.6); // a positive-x sample
    expect(driven[i]!).toBeGreaterThan(clean[i]!); // more drive → more gain on the curve
  });

  it('the default band is a sane comms range (highpass below lowpass, voice band)', () => {
    expect(RADIO_FX_DEFAULTS.highpassHz).toBeLessThan(RADIO_FX_DEFAULTS.lowpassHz);
    expect(RADIO_FX_DEFAULTS.highpassHz).toBeGreaterThanOrEqual(200);
    expect(RADIO_FX_DEFAULTS.lowpassHz).toBeLessThanOrEqual(5000);
    expect(RADIO_FX_DEFAULTS.beep.durationMs).toBeGreaterThan(0);
    expect(RADIO_FX_DEFAULTS.staticGain).toBeGreaterThan(0);
    expect(RADIO_FX_DEFAULTS.staticGain).toBeLessThan(0.1); // faint, under the voice
  });
});
