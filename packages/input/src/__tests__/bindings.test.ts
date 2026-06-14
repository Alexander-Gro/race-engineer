import { describe, expect, it } from 'vitest';
import { BindingSet, ButtonCapture } from '../bindings';
import type { ButtonRef } from '../types';

const A: ButtonRef = { deviceGuid: 'wheel', buttonIndex: 3 };
const B: ButtonRef = { deviceGuid: 'wheel', buttonIndex: 7 };

describe('BindingSet', () => {
  it('binds and looks up an action by button', () => {
    const s = new BindingSet();
    s.set({ action: 'ptt', button: A, deviceName: 'Wheel' });
    expect(s.get(A)).toBe('ptt');
    expect(s.get(B)).toBeNull();
    expect(s.forAction('ptt')?.button).toEqual(A);
  });

  it('moves an action to a new button (one button per action)', () => {
    const s = new BindingSet();
    s.set({ action: 'ptt', button: A, deviceName: 'Wheel' });
    s.set({ action: 'ptt', button: B, deviceName: 'Wheel' });
    expect(s.get(A)).toBeNull();
    expect(s.get(B)).toBe('ptt');
    expect(s.list()).toHaveLength(1);
  });

  it('replaces the action on a re-used button (one action per button)', () => {
    const s = new BindingSet();
    s.set({ action: 'repeat_last', button: A, deviceName: 'Wheel' });
    s.set({ action: 'acknowledge_box', button: A, deviceName: 'Wheel' });
    expect(s.get(A)).toBe('acknowledge_box');
    expect(s.list()).toHaveLength(1);
  });

  it('round-trips through JSON for persistence', () => {
    const s = new BindingSet();
    s.set({ action: 'ptt', button: A, deviceName: 'Wheel' });
    s.set({ action: 'repeat_last', button: B, deviceName: 'Wheel' });
    const restored = BindingSet.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(restored.get(A)).toBe('ptt');
    expect(restored.get(B)).toBe('repeat_last');
  });

  it('clearAction removes a binding', () => {
    const s = new BindingSet();
    s.set({ action: 'ptt', button: A, deviceName: 'Wheel' });
    s.clearAction('ptt');
    expect(s.get(A)).toBeNull();
  });
});

describe('ButtonCapture (press-to-map)', () => {
  it('captures the first down edge while active, then stops', () => {
    const c = new ButtonCapture();
    expect(c.feed([{ button: A, kind: 'down', atMs: 0 }])).toBeNull(); // inactive
    c.start();
    expect(c.active).toBe(true);
    expect(c.feed([{ button: A, kind: 'up', atMs: 1 }])).toBeNull(); // up edges ignored
    expect(c.feed([{ button: B, kind: 'down', atMs: 2 }])).toEqual(B);
    expect(c.active).toBe(false); // stops after capturing
  });

  it('cancel stops a capture', () => {
    const c = new ButtonCapture();
    c.start();
    c.cancel();
    expect(c.feed([{ button: A, kind: 'down', atMs: 0 }])).toBeNull();
  });
});
