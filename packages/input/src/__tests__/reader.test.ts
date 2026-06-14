import { describe, expect, it } from 'vitest';
import { MockBackend } from '../backends/mock';
import { BindingSet } from '../bindings';
import { InputReader } from '../reader';
import type { ActionBinding, ButtonRef, InputAction } from '../types';

const PTT: ButtonRef = { deviceGuid: 'mock-wheel', buttonIndex: 5 };

/** A controllable app clock for deterministic edge timing. */
const makeClock = (): { now: () => number; advance: (ms: number) => void } => {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
};

describe('InputReader', () => {
  it('emits PTT down then up for the bound button', () => {
    const backend = new MockBackend();
    const bindings = new BindingSet();
    bindings.set({ action: 'ptt', button: PTT, deviceName: 'Mock Wheel' });
    const clock = makeClock();
    const ptt: Array<{ down: boolean; atMs: number }> = [];
    const reader = new InputReader({
      backend,
      bindings,
      now: clock.now,
      events: { onPtt: (down, atMs) => ptt.push({ down, atMs }) },
    });

    clock.advance(100);
    backend.press(PTT);
    reader.poll(); // down @100
    clock.advance(50);
    reader.poll(); // held — no event
    clock.advance(50);
    backend.release(PTT);
    reader.poll(); // up @200

    expect(ptt).toEqual([
      { down: true, atMs: 100 },
      { down: false, atMs: 200 },
    ]);
  });

  it('fires quick actions on press only (not release)', () => {
    const backend = new MockBackend();
    const QA: ButtonRef = { deviceGuid: 'mock-wheel', buttonIndex: 9 };
    const bindings = new BindingSet();
    bindings.set({ action: 'repeat_last', button: QA, deviceName: 'Mock Wheel' });
    const clock = makeClock();
    const actions: InputAction[] = [];
    const reader = new InputReader({
      backend,
      bindings,
      now: clock.now,
      events: { onAction: (a) => actions.push(a) },
    });

    clock.advance(100);
    backend.press(QA);
    reader.poll();
    clock.advance(100);
    backend.release(QA);
    reader.poll();

    expect(actions).toEqual(['repeat_last']);
  });

  it('ignores unbound buttons', () => {
    const backend = new MockBackend();
    const clock = makeClock();
    let ptt = 0;
    let act = 0;
    const reader = new InputReader({
      backend,
      now: clock.now,
      events: {
        onPtt: () => {
          ptt += 1;
        },
        onAction: () => {
          act += 1;
        },
      },
    });
    clock.advance(10);
    backend.press({ deviceGuid: 'mock-wheel', buttonIndex: 1 });
    reader.poll();
    expect(ptt).toBe(0);
    expect(act).toBe(0);
  });

  it('press-to-map binds the next press (with device name) and does not dispatch it', () => {
    const backend = new MockBackend([{ guid: 'mock-wheel', name: 'Mock Wheel', buttonCount: 24 }]);
    const clock = makeClock();
    const mapped: ActionBinding[] = [];
    const ptt: boolean[] = [];
    const reader = new InputReader({
      backend,
      now: clock.now,
      events: { onMapped: (b) => mapped.push(b), onPtt: (down) => ptt.push(down) },
    });

    reader.beginMapping('ptt');
    expect(reader.mapping).toBe('ptt');

    clock.advance(100);
    backend.press(PTT);
    reader.poll(); // captured as the PTT binding — not dispatched
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({ action: 'ptt', button: PTT, deviceName: 'Mock Wheel' });
    expect(reader.mapping).toBeNull();
    expect(ptt).toEqual([]); // the mapping press itself produced no PTT event

    // Now bound: release + re-press dispatch PTT normally.
    clock.advance(50);
    backend.release(PTT);
    reader.poll();
    clock.advance(50);
    backend.press(PTT);
    reader.poll();
    expect(ptt).toEqual([false, true]);
  });

  it('debounces a bouncy press into a single PTT down', () => {
    const backend = new MockBackend();
    const bindings = new BindingSet();
    bindings.set({ action: 'ptt', button: PTT, deviceName: 'Mock Wheel' });
    const clock = makeClock();
    const ptt: boolean[] = [];
    const reader = new InputReader({
      backend,
      bindings,
      debounceMs: 30,
      now: clock.now,
      events: { onPtt: (down) => ptt.push(down) },
    });

    backend.press(PTT);
    reader.poll(); // down @0
    clock.advance(5);
    backend.release(PTT);
    reader.poll(); // bounce up @5 — ignored
    clock.advance(5);
    backend.press(PTT);
    reader.poll(); // bounce down @10 — still logically down

    expect(ptt).toEqual([true]);
  });
});
