import { describe, expect, it } from 'vitest';
import { intervalForHz, Throttle } from '../throttle';

describe('Throttle', () => {
  it('emits the first sample, then at most one per interval (on the chosen clock)', () => {
    const throttle = new Throttle<number>(50, (n) => n);
    const stamps = [0, 16, 33, 50, 66, 83, 100, 120];
    expect(stamps.filter((t) => throttle.accept(t))).toEqual([0, 50, 100]);
    expect(throttle.lastMs).toBe(100);
  });

  it('an interval of 0 accepts every sample', () => {
    const throttle = new Throttle<number>(0, (n) => n);
    expect([0, 0, 1, 1, 2].filter((t) => throttle.accept(t))).toEqual([0, 0, 1, 1, 2]);
  });
});

describe('intervalForHz', () => {
  it('converts Hz to ms and clamps to ≥ 1 Hz', () => {
    expect(intervalForHz(10)).toBe(100);
    expect(intervalForHz(15)).toBeCloseTo(66.67, 1);
    expect(intervalForHz(0)).toBe(1000); // clamped to 1 Hz
    expect(intervalForHz(-5)).toBe(1000);
  });
});
