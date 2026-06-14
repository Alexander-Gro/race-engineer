import type { Tire } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import {
  assessTireWindow,
  assessTireWindows,
  degLossOverStintS,
  fitTireDegradation,
  predictLapTimeS,
  type TireLapSample,
} from '../tires';

/** A clean linear stint: base 100.0 s, 0.1 s/lap degradation → lap k = 100.0 + 0.1·k. */
const linearStint = (laps: number, base = 100, deg = 0.1): TireLapSample[] =>
  Array.from({ length: laps }, (_, i) => ({ stintLap: i + 1, lapTimeS: base + deg * (i + 1) }));

const tire = (tempC: Tire['tempC']): Tire => ({
  tempC,
  pressureKpa: 170,
  wear01: 0.8,
  compound: 'medium',
  surfaceTempC: typeof tempC === 'number' ? tempC : tempC.center,
});

describe('fitTireDegradation', () => {
  it('recovers the slope and intercept from a clean linear stint (worked example)', () => {
    const deg = fitTireDegradation({ greenStintLaps: linearStint(5) });
    expect(deg.degRatePerLapS).toBeCloseTo(0.1, 6);
    expect(deg.baseLapS).toBeCloseTo(100.0, 6);
    expect(deg.sampleCount).toBe(5);
    expect(deg.confidence01).toBeGreaterThan(0);
    expect(deg.confidence01).toBeLessThanOrEqual(1);
  });

  it('recovers the trend from noisy laps (least-squares is robust to small jitter)', () => {
    const deg = fitTireDegradation({
      greenStintLaps: [
        { stintLap: 1, lapTimeS: 100.12 },
        { stintLap: 2, lapTimeS: 100.18 },
        { stintLap: 3, lapTimeS: 100.33 },
        { stintLap: 4, lapTimeS: 100.39 },
        { stintLap: 5, lapTimeS: 100.51 },
      ],
    });
    expect(deg.degRatePerLapS).toBeCloseTo(0.1, 1);
    expect(deg.baseLapS).toBeCloseTo(100.0, 1);
  });

  it('blends the fitted slope with a prior, weighted by lap count', () => {
    // Fit slope 0.1 over n=5; prior 0.3 with weight 3 → (3·0.3 + 5·0.1)/8 = 0.175.
    const deg = fitTireDegradation({
      greenStintLaps: linearStint(5),
      prior: { degRatePerLapS: 0.3, baseLapS: 99.0, weight: 3 },
    });
    expect(deg.degRatePerLapS).toBeCloseTo(0.175, 6);
    // base: (3·99.0 + 5·100.0)/8 = 99.625.
    expect(deg.baseLapS).toBeCloseTo(99.625, 6);
    expect(deg.confidence01).toBeCloseTo(5 / 8, 6);
  });

  it('leans on the prior when there are too few laps to fit a slope', () => {
    const deg = fitTireDegradation({
      greenStintLaps: [{ stintLap: 1, lapTimeS: 100.1 }],
      prior: { degRatePerLapS: 0.2, baseLapS: 100.0, weight: 3 },
    });
    expect(deg.degRatePerLapS).toBe(0.2); // no fit → prior slope
    expect(deg.baseLapS).toBe(100.0); // no fit → prior base
  });

  it('stays silent (confidence 0, base null) with no usable signal and no prior', () => {
    expect(fitTireDegradation({ greenStintLaps: [] })).toEqual({
      degRatePerLapS: 0,
      baseLapS: null,
      confidence01: 0,
      sampleCount: 0,
    });
    const single = fitTireDegradation({ greenStintLaps: [{ stintLap: 1, lapTimeS: 100.1 }] });
    expect(single.confidence01).toBe(0);
    expect(single.baseLapS).toBeNull();
  });
});

describe('predictLapTimeS / degLossOverStintS', () => {
  const deg = fitTireDegradation({ greenStintLaps: linearStint(5) }); // base 100, deg 0.1

  it('predicts end-of-stint pace from the fitted line', () => {
    expect(predictLapTimeS(deg, 10)).toBeCloseTo(101.0, 6); // 100 + 0.1·10
    expect(predictLapTimeS(deg, 20)).toBeCloseTo(102.0, 6);
  });

  it('returns null when the baseline is unknown', () => {
    expect(
      predictLapTimeS({ degRatePerLapS: 0.1, baseLapS: null, confidence01: 0, sampleCount: 0 }, 5),
    ).toBeNull();
  });

  it('sums cumulative degradation loss over a stint (degRate·N(N+1)/2)', () => {
    expect(degLossOverStintS(deg, 5)).toBeCloseTo(0.1 * ((5 * 6) / 2), 6); // 1.5 s
    expect(degLossOverStintS(deg, 0)).toBe(0);
    // A longer stint costs strictly more deg time than a shorter one (more deg ⇒ more loss).
    expect(degLossOverStintS(deg, 25)).toBeGreaterThan(degLossOverStintS(deg, 20));
  });
});

describe('properties', () => {
  it('confidence is monotonic in sample count and always in [0,1]', () => {
    const c = (laps: number) =>
      fitTireDegradation({ greenStintLaps: linearStint(laps) }).confidence01;
    expect(c(2)).toBeLessThan(c(5));
    expect(c(5)).toBeLessThan(c(12));
    for (const laps of [0, 1, 2, 5, 12, 30]) {
      const conf = fitTireDegradation({ greenStintLaps: linearStint(laps) }).confidence01;
      expect(conf).toBeGreaterThanOrEqual(0);
      expect(conf).toBeLessThanOrEqual(1);
    }
  });

  it('steeper degradation ⇒ slower predicted pace late in the stint; no NaN/Infinity', () => {
    const gentle = fitTireDegradation({ greenStintLaps: linearStint(6, 100, 0.05) });
    const harsh = fitTireDegradation({ greenStintLaps: linearStint(6, 100, 0.4) });
    const atLap = 30;
    expect(predictLapTimeS(harsh, atLap)!).toBeGreaterThan(predictLapTimeS(gentle, atLap)!);
    for (const v of [gentle.degRatePerLapS, harsh.degRatePerLapS, predictLapTimeS(harsh, atLap)!]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('assessTireWindow', () => {
  it('classifies a single temperature against the window', () => {
    const w = { minC: 80, maxC: 100 };
    expect(assessTireWindow(70, w)).toBe('cold');
    expect(assessTireWindow(90, w)).toBe('in-window');
    expect(assessTireWindow(110, w)).toBe('hot');
  });

  it('uses the average of inner/center/outer for a 3-zone reading', () => {
    expect(assessTireWindow({ inner: 105, center: 100, outer: 95 }, { minC: 80, maxC: 99 })).toBe(
      'hot',
    ); // avg 100 > 99
  });

  it('summarises four wheels, flagging mixed (fronts hot, rears cold)', () => {
    const w = { minC: 80, maxC: 100 };
    const tires = [tire(110), tire(108), tire(70), tire(72)]; // FL/FR hot, RL/RR cold
    const { perWheel, overall } = assessTireWindows(tires, w);
    expect(perWheel).toEqual(['hot', 'hot', 'cold', 'cold']);
    expect(overall).toBe('mixed');
    expect(assessTireWindows([tire(90), tire(90), tire(90), tire(90)], w).overall).toBe(
      'in-window',
    );
    expect(assessTireWindows([tire(110), tire(90), tire(90), tire(90)], w).overall).toBe('hot');
  });
});
