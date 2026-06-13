import { describe, expect, it } from 'vitest';
import { requestSingleInstanceLock } from './single-instance';

describe('requestSingleInstanceLock', () => {
  it('is primary by default (stub grants the lock)', () => {
    expect(requestSingleInstanceLock().isPrimary).toBe(true);
  });

  it('is primary when the acquirer grants the lock', () => {
    expect(requestSingleInstanceLock(() => true).isPrimary).toBe(true);
  });

  it('is not primary when the lock is already held by another instance', () => {
    expect(requestSingleInstanceLock(() => false).isPrimary).toBe(false);
  });
});
