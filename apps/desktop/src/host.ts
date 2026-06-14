import { createCanonicalNormalizer, type RaceState } from '@race-engineer/core';
import { scriptedScenario, syntheticAdapter } from '@race-engineer/adapter-sim-replay';
import { EngineerCore, type SnapshotTransport } from '@race-engineer/engineer-core';

/**
 * The Electron-agnostic Engineer Core wiring used by the desktop app's worker (build-plan T6.1).
 * It builds an {@link EngineerCore} over the **offline synthetic source** so the app shows live
 * values with no game running — the T6.1 verify. The worker passes a `transport` that
 * `postMessage`s snapshots to the Electron main, which forwards them to the renderer.
 *
 * The live equivalent is `createLmuEngineerCore` in `./lmu-host` (LMU adapter + `createLmuNormalizer`),
 * which the worker dynamically imports when `ENGINEER_SOURCE=lmu`. Kept here (not in the Electron
 * entry) so it stays unit-testable with no Electron and no game. Read-only/advisory — snapshots only.
 */
export interface EngineerHostOptions {
  /** Snapshot rate to the UI. Default is the Core's (12 Hz). */
  snapshotHz?: number;
  /**
   * Real-time pacing between synthetic frames (ms). Default 0 = as-fast-as-possible (tests run the
   * finite scenario to completion). The app sets this so the dashboard shows live, evolving values.
   */
  frameIntervalMs?: number;
  /** Loop the synthetic scenario forever (the app). Off by default so `start()` resolves in tests. */
  loop?: boolean;
}

export const createSyntheticEngineerCore = (
  transport: SnapshotTransport,
  options: EngineerHostOptions = {},
): EngineerCore<RaceState> =>
  new EngineerCore({
    adapter: syntheticAdapter(scriptedScenario(), {
      frameIntervalMs: options.frameIntervalMs,
      loop: options.loop,
    }),
    normalizer: createCanonicalNormalizer(),
    transport,
    snapshotHz: options.snapshotHz,
  });
