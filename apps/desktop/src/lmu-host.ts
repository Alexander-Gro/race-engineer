import {
  createLmuNormalizer,
  LmuAdapter,
  LmuRestClient,
  type LmuRawFrame,
} from '@race-engineer/adapter-lmu';
import type { EngineerEvent } from '@race-engineer/core';
import { EngineerCore, type SnapshotTransport } from '@race-engineer/engineer-core';
import { createRestMerge } from './lmu-rest';

/**
 * The **live LMU** Engineer Core wiring for the desktop worker — the production telemetry path
 * (build-plan T2.1/T2.3 + T11.3/T8.1 live half). It polls the rF2 shared-memory buffers via the
 * `LmuAdapter` (koffi → Win32) and runs them through `createLmuNormalizer()` into the canonical
 * `RaceState`, then merges in **Virtual Energy + current aids from LMU's local REST API** — both
 * absent from shared memory (docs/03 §S1/§S2). The REST poll runs on its own ~2 Hz timer **off the
 * 50 Hz SHM hot path** (see {@link createRestMerge}); the per-frame merge is a cheap pure spread.
 *
 * **Windows-only + native:** the adapter only does real work on the rig with LMU running (it imports
 * koffi). Kept in its own module so the worker can **dynamically import it only when the LMU source is
 * selected** — the default synthetic demo never loads koffi. Until LMU is in a session the adapter
 * emits nothing and REST returns null (the dashboard waits / shows no VE), so starting the app before
 * the game is fine. **Read-only/advisory:** opens read maps only, GET-only REST; no write path (rule 5).
 */
export interface LmuHostOptions {
  /** Snapshot rate to the UI (Hz). Default is the Core's (12 Hz). */
  snapshotHz?: number;
  /** Shared-memory poll rate (Hz). Default is the adapter's (50 Hz). */
  pollHz?: number;
  /** Immediate (off-throttle) detected events, for the proactive voice layer (docs/01 Tier-0). */
  onEvent?: (events: readonly EngineerEvent[]) => void;
  /** REST client for the VE/aids merge; injected in tests. Default: a GET-only `LmuRestClient`. */
  restClient?: Pick<LmuRestClient, 'get'>;
}

/** A running live source — `start()`/`stop()` drive both the SHM pipeline and the REST poll. */
export interface LmuEngineerCore {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** A no-op REST client used when the runtime has no `fetch` (so the host degrades, never crashes). */
const nullRestClient: Pick<LmuRestClient, 'get'> = { get: async () => null };

const defaultRestClient = (): Pick<LmuRestClient, 'get'> => {
  try {
    return new LmuRestClient(); // uses the runtime's global fetch (Node 18+/Electron)
  } catch {
    return nullRestClient;
  }
};

export const createLmuEngineerCore = (
  transport: SnapshotTransport,
  options: LmuHostOptions = {},
): LmuEngineerCore => {
  const base = createLmuNormalizer();
  const rest = createRestMerge({ client: options.restClient ?? defaultRestClient() });
  // Wrap the SHM normalizer so every frame's RaceState carries the latest REST VE/aids before the
  // strategy engine + detector run on it (the merge is pure; the network poll is the separate timer).
  const normalizer = { toRaceState: (frame: LmuRawFrame) => rest.merge(base.toRaceState(frame)) };

  const core = new EngineerCore<LmuRawFrame>({
    adapter: new LmuAdapter({ hz: options.pollHz }),
    normalizer,
    transport,
    snapshotHz: options.snapshotHz,
    onEvent: options.onEvent,
  });

  return {
    start: async () => {
      rest.start(); // begin the ~2 Hz REST poll alongside the SHM pipeline
      await core.start();
    },
    stop: async () => {
      rest.stop();
      await core.stop();
    },
  };
};
