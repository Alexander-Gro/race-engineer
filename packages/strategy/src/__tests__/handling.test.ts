import type { Tire } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import { diagnoseHandling } from '../handling';

/** A Tire with the given temps (zones or single value); other fields are filler. */
const tyre = (tempC: Tire['tempC']): Tire => ({
  tempC,
  pressureKpa: 170,
  wear01: 0.8,
  compound: 'medium',
  surfaceTempC: typeof tempC === 'number' ? tempC : tempC.center,
});

const zones = (inner: number, center: number, outer: number): Tire =>
  tyre({ inner, center, outer });

/** Four corners FL, FR, RL, RR. */
const car = (fl: Tire, fr: Tire, rl: Tire, rr: Tire): Tire[] => [fl, fr, rl, rr];

describe('diagnoseHandling — camber (inner vs outer)', () => {
  it('reads inner-hot / outer-hot / balanced from the inner-outer spread', () => {
    const d = diagnoseHandling(
      car(
        zones(100, 90, 80), // FL: inner 100, outer 80 → +20 → inner-hot
        zones(80, 90, 100), // FR: inner 80, outer 100 → −20 → outer-hot
        zones(90, 90, 88), //  RL: +2 within 8 → balanced
        zones(95, 90, 85), //  RR: +10 → inner-hot
      ),
    );
    expect(d.camber.map((c) => c.hint)).toEqual([
      'inner-hot',
      'outer-hot',
      'balanced',
      'inner-hot',
    ]);
    expect(d.camber[0]!.deltaC).toBe(20);
    expect(d.camber[1]!.deltaC).toBe(-20);
  });

  it('honors a custom camber threshold', () => {
    const tyres = car(zones(95, 90, 85), zones(90, 90, 90), zones(90, 90, 90), zones(90, 90, 90));
    expect(diagnoseHandling(tyres).camber[0]!.hint).toBe('inner-hot'); // +10 > default 8
    expect(diagnoseHandling(tyres, { camberDeltaC: 12 }).camber[0]!.hint).toBe('balanced'); // +10 ≤ 12
  });
});

describe('diagnoseHandling — pressure (centre vs edges)', () => {
  it('centre hotter than edges = over, cooler = under, level = balanced', () => {
    const d = diagnoseHandling(
      car(
        zones(85, 100, 85), // centre 100 vs edges 85 → +15 → over-inflated
        zones(85, 70, 85), //  centre 70 vs edges 85 → −15 → under-inflated
        zones(88, 88, 87), //  ~0.5 → balanced
        zones(85, 100, 85),
      ),
    );
    expect(d.pressure.map((p) => p.hint)).toEqual(['over', 'under', 'balanced', 'over']);
    expect(d.pressure[0]!.deltaC).toBe(15);
  });
});

describe('diagnoseHandling — axle balance (front vs rear)', () => {
  it('fronts hotter ⇒ understeer, rears hotter ⇒ oversteer, level ⇒ neutral', () => {
    const understeer = diagnoseHandling(
      car(zones(90, 95, 90), zones(90, 95, 90), zones(80, 80, 80), zones(80, 80, 80)),
    );
    expect(understeer.balance).toMatchObject({
      frontAvgC: 95,
      rearAvgC: 80,
      deltaC: 15,
      tendency: 'understeer',
    });

    const oversteer = diagnoseHandling(
      car(zones(80, 80, 80), zones(80, 80, 80), zones(90, 95, 90), zones(90, 95, 90)),
    );
    expect(oversteer.balance.tendency).toBe('oversteer');

    const neutral = diagnoseHandling(
      car(zones(90, 90, 90), zones(90, 90, 90), zones(90, 88, 90), zones(90, 88, 90)),
    );
    expect(neutral.balance.tendency).toBe('neutral');
  });
});

describe('diagnoseHandling — state honesty', () => {
  it('single-value temps yield unknown camber/pressure but still a balance read', () => {
    const d = diagnoseHandling(car(tyre(95), tyre(95), tyre(80), tyre(80)));
    expect(d.camber.every((c) => c.hint === 'unknown' && c.deltaC === null)).toBe(true);
    expect(d.pressure.every((p) => p.hint === 'unknown')).toBe(true);
    expect(d.balance.tendency).toBe('understeer'); // 95 vs 80
    expect(d.confidence01).toBe(0); // no zone data
  });

  it('confidence is the fraction of corners with zone temps', () => {
    expect(
      diagnoseHandling(
        car(zones(90, 90, 90), zones(90, 90, 90), zones(90, 90, 90), zones(90, 90, 90)),
      ).confidence01,
    ).toBe(1);
    expect(
      diagnoseHandling(car(zones(90, 90, 90), zones(90, 90, 90), tyre(90), tyre(90))).confidence01,
    ).toBe(0.5);
  });

  it('degrades gracefully with fewer than four tyres', () => {
    const d = diagnoseHandling([zones(100, 90, 80)]);
    expect(d.camber[0]!.hint).toBe('inner-hot');
    expect(d.camber[3]!.hint).toBe('unknown'); // missing RR
    expect(d.balance.rearAvgC).toBeNull();
    expect(d.balance.tendency).toBe('unknown');
  });
});

describe('diagnoseHandling — properties', () => {
  it('swapping inner/outer flips the camber hint (sign-symmetric)', () => {
    const a = diagnoseHandling(car(zones(100, 90, 80), tyre(90), tyre(90), tyre(90))).camber[0]!;
    const b = diagnoseHandling(car(zones(80, 90, 100), tyre(90), tyre(90), tyre(90))).camber[0]!;
    expect(a.hint).toBe('inner-hot');
    expect(b.hint).toBe('outer-hot');
    expect(a.deltaC).toBe(-b.deltaC!);
  });

  it('never produces NaN; confidence stays in [0,1] across a sweep', () => {
    for (let base = 40; base <= 120; base += 10) {
      for (let spread = 0; spread <= 30; spread += 5) {
        const d = diagnoseHandling(
          car(
            zones(base + spread, base, base - spread),
            zones(base, base, base),
            zones(base - spread, base, base + spread),
            tyre(base),
          ),
        );
        expect(d.confidence01).toBeGreaterThanOrEqual(0);
        expect(d.confidence01).toBeLessThanOrEqual(1);
        for (const c of [...d.camber, ...d.pressure]) {
          if (c.deltaC !== null) expect(Number.isFinite(c.deltaC)).toBe(true);
        }
        if (d.balance.deltaC !== null) expect(Number.isFinite(d.balance.deltaC)).toBe(true);
      }
    }
  });
});
