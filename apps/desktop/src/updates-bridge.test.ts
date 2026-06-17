import { describe, expect, it } from 'vitest';
import {
  formatUpdateStatus,
  isInstallReady,
  isUpdateBusy,
  type UpdateStatus,
} from './updates-bridge';

describe('formatUpdateStatus', () => {
  it('renders each status as readable footer text', () => {
    expect(formatUpdateStatus({ kind: 'idle' })).toBe('');
    expect(formatUpdateStatus({ kind: 'checking' })).toMatch(/checking/i);
    expect(formatUpdateStatus({ kind: 'available', version: '0.2.0' })).toContain('0.2.0');
    expect(formatUpdateStatus({ kind: 'up-to-date', version: '0.2.0' })).toMatch(/latest/i);
    expect(formatUpdateStatus({ kind: 'downloading', percent: 42.6 })).toContain('43%'); // rounded
    expect(formatUpdateStatus({ kind: 'downloaded', version: '0.2.0' })).toMatch(/restart/i);
    expect(formatUpdateStatus({ kind: 'error', message: 'no net' })).toContain('no net');
    expect(formatUpdateStatus({ kind: 'unsupported' })).toMatch(/installed app/i);
  });
});

describe('button-state helpers', () => {
  it('offers install only once an update is downloaded', () => {
    expect(isInstallReady({ kind: 'downloaded', version: '1' })).toBe(true);
    for (const s of [
      { kind: 'idle' },
      { kind: 'checking' },
      { kind: 'available', version: '1' },
      { kind: 'up-to-date', version: '1' },
    ] as UpdateStatus[]) {
      expect(isInstallReady(s)).toBe(false);
    }
  });

  it('is busy while checking or downloading, idle otherwise', () => {
    expect(isUpdateBusy({ kind: 'checking' })).toBe(true);
    expect(isUpdateBusy({ kind: 'downloading', percent: 10 })).toBe(true);
    expect(isUpdateBusy({ kind: 'downloaded', version: '1' })).toBe(false);
    expect(isUpdateBusy({ kind: 'up-to-date', version: '1' })).toBe(false);
  });
});
