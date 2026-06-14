import { describe, expect, it } from 'vitest';
import { evaluateUndercut, undercutGainS, type UndercutInput } from '../undercut';

/** A baseline successful undercut: 2 laps on fresh tyres worth 1.5 s/lap, 0.6 s out-lap, equal pit. */
const baseChase: UndercutInput = {
  rival: 'ahead',
  gapS: 0.8,
  freshTyreGainPerLapS: 1.5,
  lapsRivalStaysOut: 2,
  outLapLossS: 0.6,
  pitLossSelfS: 25,
};

describe('undercutGainS', () => {
  it('is laps·freshGain − outLap − pitDelta (worked example: 2·1.5 − 0.6 − 0 = 2.4)', () => {
    expect(undercutGainS(baseChase)).toBeCloseTo(2.4, 6);
  });

  it('subtracts a slower-than-rival pit stop (pit-delta difference)', () => {
    // pitLossSelf 28 vs rival 24 → pitDelta 4 → 3.0 − 0.6 − 4 = −1.6.
    expect(undercutGainS({ ...baseChase, pitLossSelfS: 28, pitLossRivalS: 24 })).toBeCloseTo(
      -1.6,
      6,
    );
  });

  it('defaults: 1 lap horizon, no out-lap loss, rival pit-loss = yours', () => {
    expect(
      undercutGainS({ rival: 'ahead', gapS: 1, freshTyreGainPerLapS: 1.0, pitLossSelfS: 25 }),
    ).toBeCloseTo(1.0, 6);
  });
});

describe('evaluateUndercut — chasing a rival ahead', () => {
  it("recommends 'now' when the swing clears the gap (worked example)", () => {
    const d = evaluateUndercut(baseChase);
    expect(d.recommend).toBe('now');
    expect(d.undercutGainS).toBeCloseTo(2.4, 6);
    expect(d.deltaS).toBeCloseTo(2.4 - 0.8, 6); // 1.6 clear
    expect(d.rationale).toMatch(/box now/i);
  });

  it("recommends 'later' (overcut) when pitting now is a net time loss — tyres too fresh", () => {
    const d = evaluateUndercut({
      rival: 'ahead',
      gapS: 1.0,
      freshTyreGainPerLapS: 0.2,
      lapsRivalStaysOut: 1,
      outLapLossS: 1.0,
      pitLossSelfS: 25,
    });
    expect(d.recommend).toBe('later');
    expect(d.undercutGainS).toBeCloseTo(-0.8, 6);
    expect(d.rationale).toMatch(/overcut/i);
  });

  it("recommends 'hold' when the undercut gains time but not enough to clear the gap", () => {
    const d = evaluateUndercut({
      rival: 'ahead',
      gapS: 2.0,
      freshTyreGainPerLapS: 1.0,
      lapsRivalStaysOut: 1,
      outLapLossS: 0.3,
      pitLossSelfS: 25,
    });
    expect(d.recommend).toBe('hold');
    expect(d.undercutGainS).toBeCloseTo(0.7, 6);
    expect(d.deltaS).toBeCloseTo(-1.3, 6);
  });

  it("a slower own pit stop flips the same chase from 'now' to 'later'", () => {
    const d = evaluateUndercut({ ...baseChase, pitLossSelfS: 28, pitLossRivalS: 24 });
    expect(d.recommend).toBe('later'); // gain −1.6 < −margin
  });
});

describe('evaluateUndercut — defending from a rival behind', () => {
  it("recommends 'now' (cover) when the rival could undercut into your lead", () => {
    const d = evaluateUndercut({
      rival: 'behind',
      gapS: 0.5,
      freshTyreGainPerLapS: 1.5,
      lapsRivalStaysOut: 2,
      outLapLossS: 0.6,
      pitLossSelfS: 25,
    });
    expect(d.recommend).toBe('now');
    expect(d.deltaS).toBeCloseTo(0.5 - 2.4, 6); // −1.9 → lead lost
    expect(d.rationale).toMatch(/defend/i);
  });

  it("recommends 'hold' when the lead is safe against a rival stop", () => {
    const d = evaluateUndercut({
      rival: 'behind',
      gapS: 5.0,
      freshTyreGainPerLapS: 1.0,
      lapsRivalStaysOut: 1,
      outLapLossS: 0.5,
      pitLossSelfS: 25,
    });
    expect(d.recommend).toBe('hold');
    expect(d.deltaS).toBeCloseTo(4.5, 6);
    expect(d.rationale).toMatch(/safe/i);
  });
});

describe('confidence & honesty', () => {
  it('passes through the fresh-tyre-advantage confidence, defaulting to 0.5, clamped to [0,1]', () => {
    expect(evaluateUndercut(baseChase).confidence01).toBe(0.5);
    expect(evaluateUndercut({ ...baseChase, confidence01: 0.9 }).confidence01).toBe(0.9);
    expect(evaluateUndercut({ ...baseChase, confidence01: 2 }).confidence01).toBe(1);
    expect(evaluateUndercut({ ...baseChase, confidence01: -1 }).confidence01).toBe(0);
  });
});

describe('properties', () => {
  it('undercut gain is monotonic increasing in fresh-tyre advantage; no NaN/Infinity', () => {
    let prev = -Infinity;
    for (const g of [0, 0.5, 1.0, 1.5, 2.5]) {
      const gain = undercutGainS({ ...baseChase, freshTyreGainPerLapS: g });
      expect(gain).toBeGreaterThan(prev);
      expect(Number.isFinite(gain)).toBe(true);
      prev = gain;
    }
  });

  it('a larger gap (chasing) never improves the clearance and eventually stops being a "now"', () => {
    let prevDelta = Infinity;
    let sawNonNow = false;
    for (const gapS of [0.5, 1.0, 2.0, 4.0, 8.0]) {
      const d = evaluateUndercut({ ...baseChase, gapS });
      expect(d.deltaS).toBeLessThan(prevDelta);
      expect(Number.isFinite(d.deltaS)).toBe(true);
      if (d.recommend !== 'now') sawNonNow = true;
      prevDelta = d.deltaS;
    }
    expect(sawNonNow).toBe(true); // a big enough gap is no longer an undercut
  });
});
