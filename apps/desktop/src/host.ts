import { createCanonicalNormalizer, type RaceState } from '@race-engineer/core';
import { scriptedScenario, syntheticAdapter } from '@race-engineer/adapter-sim-replay';
import { EngineerCore, type SnapshotTransport } from '@race-engineer/engineer-core';

/**
 * The Electron-agnostic Engineer Core wiring used by the desktop app's worker (build-plan T6.1).
 * It builds an {@link EngineerCore} over the **offline synthetic source** so the app shows live
 * values with no game running — the T6.1 verify. The worker passes a `transport` that
 * `postMessage`s snapshots to the Electron main, which forwards them to the renderer.
 *
 * Going live is a one-line swap: replace `syntheticAdapter(...)` + `createCanonicalNormalizer()`
 * with the LMU adapter + `createLmuNormalizer()`. Kept here (not in the Electron entry) so it
 * stays unit-testable with no Electron and no game. Read-only/advisory — snapshots only.
 */
export interface EngineerHostOptions {
  /** Snapshot rate to the UI. Default is the Core's (12 Hz). */
  snapshotHz?: number;
}

export const createSyntheticEngineerCore = (
  transport: SnapshotTransport,
  options: EngineerHostOptions = {},
): EngineerCore<RaceState> =>
  new EngineerCore({
    adapter: syntheticAdapter(scriptedScenario()),
    normalizer: createCanonicalNormalizer(),
    transport,
    snapshotHz: options.snapshotHz,
  });
