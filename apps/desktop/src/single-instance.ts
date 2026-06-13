/**
 * Single-instance lock (docs/16 §9: "refuse to launch a second copy").
 *
 * STUB: the real lock wires Electron's `app.requestSingleInstanceLock()` in T6.1 (Electron
 * shell). This keeps the contract and a testable decision so the launch flow can depend on it
 * now, with no Electron dependency installed yet. The app is read-only and advisory — this
 * only governs whether *this process* should continue or defer to an already-running copy.
 */

export interface SingleInstanceResult {
  /** True if this process holds the lock and should start the app. */
  isPrimary: boolean;
}

/** Acquire the OS/runtime single-instance lock. Returns true if this process got it. */
export type LockAcquirer = () => boolean;

/**
 * Decide whether this is the primary instance. `acquireLock` defaults to a stub that always
 * grants the lock; T6.1 will pass `() => app.requestSingleInstanceLock()`.
 */
export const requestSingleInstanceLock = (
  acquireLock: LockAcquirer = () => true,
): SingleInstanceResult => ({ isPrimary: acquireLock() });
