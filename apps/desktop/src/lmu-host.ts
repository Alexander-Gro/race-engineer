import { createLmuNormalizer, LmuAdapter, type LmuRawFrame } from '@race-engineer/adapter-lmu';
import { EngineerCore, type SnapshotTransport } from '@race-engineer/engineer-core';

/**
 * The **live LMU** Engineer Core wiring for the desktop worker — the production telemetry path
 * (build-plan T2.1/T2.3). It polls the rF2 shared-memory buffers via the `LmuAdapter` (koffi →
 * Win32) and runs them through `createLmuNormalizer()` into the canonical `RaceState`, exactly
 * mirroring `createSyntheticEngineerCore` but reading the real game.
 *
 * **Windows-only + native:** the adapter only does real work on the rig with LMU running (it
 * imports koffi). Kept in its own module so the worker can **dynamically import it only when the
 * LMU source is selected** — the default synthetic demo never loads koffi. Until LMU is in a
 * session the adapter polls and emits nothing (the dashboard waits), so starting the app before
 * the game is fine. **Read-only/advisory:** opens read maps only; no write path (CLAUDE.md rule 5).
 */
export interface LmuHostOptions {
  /** Snapshot rate to the UI (Hz). Default is the Core's (12 Hz). */
  snapshotHz?: number;
  /** Shared-memory poll rate (Hz). Default is the adapter's (50 Hz). */
  pollHz?: number;
}

export const createLmuEngineerCore = (
  transport: SnapshotTransport,
  options: LmuHostOptions = {},
): EngineerCore<LmuRawFrame> =>
  new EngineerCore({
    adapter: new LmuAdapter({ hz: options.pollHz }),
    normalizer: createLmuNormalizer(),
    transport,
    snapshotHz: options.snapshotHz,
  });
