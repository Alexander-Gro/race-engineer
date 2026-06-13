import { describe, expect, it } from 'vitest';
import { readWithTornGuard, type VersionPair } from '../shm/torn-read';

describe('readWithTornGuard', () => {
  it('returns the snapshot when versions are stable', () => {
    const result = readWithTornGuard({
      readVersion: () => ({ begin: 5, end: 5 }),
      copyBuffer: () => 'snapshot',
    });
    expect(result).toEqual({ value: 'snapshot', version: 5 });
  });

  it('retries through an in-flight write, then accepts a stable frame', () => {
    // 1st read: torn (begin!=end) -> retry; 2nd+3rd: stable & unchanged -> accept
    const versions: VersionPair[] = [
      { begin: 1, end: 0 },
      { begin: 2, end: 2 },
      { begin: 2, end: 2 },
    ];
    let call = 0;
    const result = readWithTornGuard({
      readVersion: () => versions[Math.min(call++, versions.length - 1)] ?? { begin: 0, end: 0 },
      copyBuffer: () => 'snap',
    });
    expect(result?.value).toBe('snap');
    expect(result?.version).toBe(2);
  });

  it('returns null when a stable read is never obtained', () => {
    const result = readWithTornGuard({
      readVersion: () => ({ begin: 1, end: 2 }),
      copyBuffer: () => 'x',
      maxRetries: 3,
    });
    expect(result).toBeNull();
  });

  it('rejects a frame whose version changed during the copy', () => {
    // stable before (3,3) but version moved to (4,4) after the copy -> torn -> retry -> null
    const versions: VersionPair[] = [
      { begin: 3, end: 3 },
      { begin: 4, end: 4 },
    ];
    let call = 0;
    const result = readWithTornGuard({
      readVersion: () => versions[Math.min(call++, versions.length - 1)] ?? { begin: 9, end: 9 },
      copyBuffer: () => 'x',
      maxRetries: 0,
    });
    expect(result).toBeNull();
  });
});
