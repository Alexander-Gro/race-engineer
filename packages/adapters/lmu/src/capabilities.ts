import type { AdapterCapabilities } from '@race-engineer/core';

/**
 * What the LMU shared-memory adapter actually provides (docs/03, confirmed live 2026-06-14).
 * REST (T2.2) adds standings/Virtual-Energy/garage data later; setup reads (M9) and the
 * current TC/ABS/engine-map indices (REST/setup, S2/S3) are not in shared memory, so
 * `readsCurrentAids` is false for now even though brake bias *is* readable from telemetry.
 */
export const lmuCapabilities = (): AdapterCapabilities => ({
  hasSharedMemory: true,
  hasRestApi: false, // REST client lands in T2.2
  readsCurrentAids: false, // SHM exposes brake bias only; TC/ABS/engine-map index need REST/setup
  readsSetup: false, // setup-file read lands in M9 (S4)
  exposesTireCompound: true, // compound name strings populate (e.g. "Medium")
  fields: new Set([
    'session',
    'flags',
    'track',
    'weather',
    'player.fuel',
    'player.tires',
    'player.brakes',
    'player.engine',
    'player.aids.brakeBias',
    'cars',
  ]),
});
