import { describe, expect, it } from 'vitest';
import { EdgeDetector } from '../edges';
import type { ButtonRef } from '../types';

const A: ButtonRef = { deviceGuid: 'wheel', buttonIndex: 3 };
const B: ButtonRef = { deviceGuid: 'wheel', buttonIndex: 7 };

describe('EdgeDetector', () => {
  it('emits a down then up edge across a press/release', () => {
    const d = new EdgeDetector(30);
    expect(d.update([], 0)).toEqual([]);
    expect(d.update([A], 100)).toEqual([{ button: A, kind: 'down', atMs: 100 }]);
    expect(d.update([A], 150)).toEqual([]); // held — no change
    expect(d.update([], 200)).toEqual([{ button: A, kind: 'up', atMs: 200 }]);
  });

  it('debounces contact bounce within the lockout window', () => {
    const d = new EdgeDetector(30);
    expect(d.update([A], 0)).toHaveLength(1); // down @0 accepted
    expect(d.update([], 5)).toEqual([]); // release @5 (<30 ms) — bounce, ignored
    expect(d.update([A], 10)).toEqual([]); // re-press @10 — still logically down
    expect(d.update([], 40)).toEqual([{ button: A, kind: 'up', atMs: 40 }]); // 40−0≥30 — accepted
  });

  it('with zero debounce reports every transition', () => {
    const d = new EdgeDetector(0);
    expect(d.update([A], 0)).toHaveLength(1);
    expect(d.update([], 1)).toHaveLength(1);
    expect(d.update([A], 2)).toHaveLength(1);
  });

  it('tracks multiple buttons independently', () => {
    const d = new EdgeDetector(30);
    const both = d.update([A, B], 0);
    expect(both.map((e) => e.kind)).toEqual(['down', 'down']);
    expect(d.update([B], 100)).toEqual([{ button: A, kind: 'up', atMs: 100 }]); // only A released
  });

  it('reset clears debounce memory', () => {
    const d = new EdgeDetector(30);
    d.update([A], 0);
    d.reset();
    expect(d.update([A], 1)).toEqual([{ button: A, kind: 'down', atMs: 1 }]);
  });
});
