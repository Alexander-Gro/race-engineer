import { describe, expect, it, vi } from 'vitest';
import {
  applyOutputDevice,
  listOutputDevices,
  releaseStream,
  requestMicAccess,
  watchDeviceChanges,
  type AudioOutputElement,
  type MediaDeviceInfoLike,
  type MediaDevicesLike,
  type MediaStreamLike,
} from './audio-io';

/** A mediaDevices mock whose getUserMedia rejects with a DOMException-shaped error. */
const micRejecting = (name: string): MediaDevicesLike => ({
  getUserMedia: () => Promise.reject(Object.assign(new Error(name), { name })),
  enumerateDevices: () => Promise.resolve([]),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

const devices = (list: MediaDeviceInfoLike[]): MediaDevicesLike => ({
  getUserMedia: () => Promise.reject(new Error('not used')),
  enumerateDevices: () => Promise.resolve(list),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

describe('requestMicAccess', () => {
  it('resolves with the stream when access is granted', async () => {
    const stream: MediaStreamLike = { getTracks: () => [] };
    const md: MediaDevicesLike = {
      ...micRejecting('x'),
      getUserMedia: () => Promise.resolve(stream),
    };
    const access = await requestMicAccess(md);
    expect(access).toEqual({ ok: true, stream });
  });

  it('maps a permission denial to guidance + an open-settings affordance (no throw)', async () => {
    const access = await requestMicAccess(micRejecting('NotAllowedError'));
    expect(access.ok).toBe(false);
    if (access.ok) throw new Error('expected denial');
    expect(access.reason).toBe('denied');
    expect(access.canOpenSettings).toBe(true);
    expect(access.message).toMatch(/Settings/);
  });

  it('maps a missing device to no-device guidance (text fallback, no settings link)', async () => {
    const access = await requestMicAccess(micRejecting('NotFoundError'));
    if (access.ok) throw new Error('expected denial');
    expect(access.reason).toBe('no-device');
    expect(access.canOpenSettings).toBe(false);
    expect(access.message).toMatch(/type to the engineer/i);
  });

  it('maps an in-use device and unknown errors without crashing', async () => {
    expect((await requestMicAccess(micRejecting('NotReadableError'))).ok).toBe(false);
    const unknown = await requestMicAccess(micRejecting('SomethingElse'));
    if (unknown.ok) throw new Error('expected denial');
    expect(unknown.reason).toBe('error');
  });

  it('reports unsupported when mediaDevices is absent (still offers the text box)', async () => {
    const access = await requestMicAccess(undefined);
    if (access.ok) throw new Error('expected denial');
    expect(access.reason).toBe('unsupported');
  });
});

describe('releaseStream', () => {
  it('stops every track so the mic is released after a check', () => {
    const stop = vi.fn();
    releaseStream({ getTracks: () => [{ stop }, { stop }] });
    expect(stop).toHaveBeenCalledTimes(2);
  });
});

describe('listOutputDevices', () => {
  it('keeps only audio outputs, flags the default, and fills blank labels', async () => {
    const out = await listOutputDevices(
      devices([
        { deviceId: 'default', kind: 'audiooutput', label: '' },
        { deviceId: 'hp', kind: 'audiooutput', label: 'Headset' },
        { deviceId: 'mic1', kind: 'audioinput', label: 'Mic' },
        { deviceId: 'cam', kind: 'videoinput', label: 'Cam' },
      ]),
    );
    expect(out).toEqual([
      { deviceId: 'default', label: 'System default', isDefault: true },
      { deviceId: 'hp', label: 'Headset', isDefault: false },
    ]);
  });
});

describe('watchDeviceChanges', () => {
  it('subscribes to devicechange and unsubscribes the same listener', () => {
    const add = vi.fn();
    const remove = vi.fn();
    const md: MediaDevicesLike = {
      ...devices([]),
      addEventListener: add,
      removeEventListener: remove,
    };
    const onChange = (): void => undefined;

    const off = watchDeviceChanges(md, onChange);
    expect(add).toHaveBeenCalledWith('devicechange', onChange);
    off();
    expect(remove).toHaveBeenCalledWith('devicechange', onChange);
  });
});

describe('applyOutputDevice', () => {
  it('routes the engineer voice to the chosen device via setSinkId', async () => {
    const setSinkId = vi.fn(() => Promise.resolve());
    expect(await applyOutputDevice({ setSinkId }, 'hp')).toEqual({ ok: true });
    expect(setSinkId).toHaveBeenCalledWith('hp');
  });

  it('degrades gracefully when setSinkId is unavailable', async () => {
    const result = await applyOutputDevice({} as AudioOutputElement, 'hp');
    if (result.ok) throw new Error('expected unsupported');
    expect(result.reason).toBe('unsupported');
  });

  it('reports an error if switching the device fails (no throw)', async () => {
    const setSinkId = vi.fn(() => Promise.reject(new Error('busy')));
    const result = await applyOutputDevice({ setSinkId }, 'hp');
    if (result.ok) throw new Error('expected error');
    expect(result.reason).toBe('error');
  });
});
