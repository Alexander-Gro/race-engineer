import {
  withAidsFromRest,
  withVirtualEnergyFromRest,
  type LmuRestClient,
} from '@race-engineer/adapter-lmu';
import type { RaceState } from '@race-engineer/core';

/**
 * Live LMU **REST → RaceState merge** (build-plan T11.3 / T8.1 live half, docs/03 §C). Virtual Energy
 * and the current driver aids are **not in the rF2 shared memory** — only LMU's local REST API exposes
 * them — so the live host polls REST and merges the result into each SHM-derived `RaceState` before the
 * strategy engine sees it.
 *
 * **Off the hot path by construction:** the network poll runs on its own ~2 Hz timer ({@link start});
 * {@link merge} (called per 50 Hz SHM frame) only does cheap pure spreads against the **last** polled
 * snapshot — no I/O on the telemetry tick. Both merge helpers prefer-SHM and return the state unchanged
 * when REST has nothing, so this is safe before LMU/REST is up (the dashboard simply shows no VE/aids).
 *
 * The REST client is **GET-only and never throws** (it degrades to null when LMU/REST is absent), so the
 * poll can't crash the worker. Read-only/advisory — it only reads REST payloads; no write path (rule 5).
 *
 * _LIVE-VERIFY:_ the VE/aids JSON field names are tolerant guesses until a rig capture pins them
 * (docs/03 §S2); the mappers narrow to the confirmed keys then, with no change here.
 */

/** The subset of REST payloads the VE + aids mappers consume. */
interface RestLatest {
  strategyUsage: unknown;
  garage: unknown;
  repairRefuel: unknown;
}

const EMPTY: RestLatest = { strategyUsage: null, garage: null, repairRefuel: null };

export interface RestMergeDeps {
  /** The GET-only REST client (only `get` is used). */
  client: Pick<LmuRestClient, 'get'>;
  /** Poll period, ms. Default 500 (~2 Hz) — matches the client's cache TTL. */
  intervalMs?: number;
  /** Injectable timer (tests). Defaults to the global `setInterval`/`clearInterval`. */
  setInterval?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface RestMerge {
  /** Merge the latest polled VE + aids into a SHM-derived state (pure; unchanged when REST has none). */
  merge(state: RaceState): RaceState;
  /** Start the ~2 Hz REST poll (idempotent). Polls once immediately, then on the interval. */
  start(): void;
  /** Stop the poll. */
  stop(): void;
  /** Fetch once now and update the latest snapshot — exposed for tests / a manual refresh. Never throws. */
  poll(): Promise<void>;
}

export const createRestMerge = (deps: RestMergeDeps): RestMerge => {
  const intervalMs = deps.intervalMs ?? 500;
  const si = deps.setInterval ?? ((fn, ms): ReturnType<typeof setInterval> => setInterval(fn, ms));
  const ci = deps.clearInterval ?? ((h): void => clearInterval(h));
  let latest: RestLatest = EMPTY;
  let handle: ReturnType<typeof setInterval> | null = null;

  const poll = async (): Promise<void> => {
    // The client is GET-only + never-throws, but guard anyway so a poll can never crash the worker.
    try {
      const [strategyUsage, garage, repairRefuel] = await Promise.all([
        deps.client.get('strategyUsage'),
        deps.client.get('garage'),
        deps.client.get('repairRefuel'),
      ]);
      latest = { strategyUsage, garage, repairRefuel };
    } catch {
      // keep the previous snapshot rather than clobbering it on a transient failure
    }
  };

  return {
    merge: (state) =>
      withAidsFromRest(
        withVirtualEnergyFromRest(state, {
          strategyUsage: latest.strategyUsage,
          repairRefuel: latest.repairRefuel,
        }),
        { garage: latest.garage, repairRefuel: latest.repairRefuel },
      ),
    start: () => {
      if (handle !== null) return;
      void poll();
      handle = si(() => void poll(), intervalMs);
    },
    stop: () => {
      if (handle !== null) {
        ci(handle);
        handle = null;
      }
    },
    poll,
  };
};
