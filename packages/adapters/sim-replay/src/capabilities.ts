import type { AdapterCapabilities } from '@race-engineer/core';

/**
 * The sim-replay source provides fully canonical frames, so it reports rich capabilities
 * even though no real game is attached. There is no shared memory or REST — frames come
 * from a recording or the synthetic generator.
 */
export const simReplayCapabilities = (): AdapterCapabilities => ({
  hasSharedMemory: false,
  hasRestApi: false,
  readsCurrentAids: true,
  readsSetup: false,
  exposesTireCompound: true,
  fields: new Set([
    'session',
    'player.fuel',
    'player.tires',
    'player.engine',
    'player.aids',
    'cars',
    'track',
    'weather',
    'flags',
  ]),
});
