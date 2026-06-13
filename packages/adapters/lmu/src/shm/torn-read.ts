/**
 * Torn-read protection for the rF2 buffers (docs/03 §S1.2). The game increments
 * `mVersionUpdateBegin` before a write and `mVersionUpdateEnd` after. A consistent snapshot
 * has `begin === end`, and `begin` must be unchanged across the copy. Pure: the caller
 * supplies the version read + buffer copy, so this is unit-testable without any FFI.
 */

export interface VersionPair {
  begin: number;
  end: number;
}

export interface StableRead<T> {
  value: T;
  version: number;
}

export interface TornReadOptions<T> {
  /** Read [begin, end] version counters from the *live* map. */
  readVersion: () => VersionPair;
  /** Copy the whole buffer from the live map. */
  copyBuffer: () => T;
  /** Max retries before giving up (default 8). */
  maxRetries?: number;
}

/**
 * Read a stable snapshot, retrying through in-flight writes. Returns null if a torn-free
 * read could not be obtained within `maxRetries` (caller skips the frame).
 */
export const readWithTornGuard = <T>(options: TornReadOptions<T>): StableRead<T> | null => {
  const maxRetries = options.maxRetries ?? 8;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const before = options.readVersion();
    if (before.begin !== before.end) continue; // a write is in progress
    const value = options.copyBuffer();
    const after = options.readVersion();
    if (after.begin === after.end && after.begin === before.begin) {
      return { value, version: before.begin };
    }
    // version moved during the copy -> torn, retry
  }
  return null;
};
