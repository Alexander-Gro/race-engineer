import type { LmuRestClient } from '@race-engineer/adapter-lmu';
import { raceStartState } from '@race-engineer/core/fixtures';
import { describe, expect, it } from 'vitest';
import { createRestMerge } from './lmu-rest';

/** A fake GET-only REST client that records the endpoints polled and returns canned payloads. */
const makeClient = (payloads: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const client: Pick<LmuRestClient, 'get'> = {
    get: async (endpoint) => {
      calls.push(endpoint);
      return payloads[endpoint] ?? null;
    },
  };
  return { client, calls };
};

describe('createRestMerge', () => {
  it('merges polled Virtual Energy (REST-only) into the SHM-derived RaceState', async () => {
    const { client } = makeClient({ strategyUsage: { virtualEnergy: 80, energyPerLap: 5 } });
    const merge = createRestMerge({ client });

    // Before any poll, REST has nothing → the state is returned unchanged (same reference).
    expect(merge.merge(raceStartState)).toBe(raceStartState);

    await merge.poll();
    const ve = merge.merge(raceStartState).player.virtualEnergy;
    expect(ve?.level01).toBeCloseTo(0.8); // 80% → 0.8
    expect(ve?.perLapAvg01).toBeCloseTo(0.05); // 5%/lap → 0.05
    expect(ve?.lapsRemainingEst).toBeCloseTo(16); // 0.8 / 0.05
  });

  it('leaves the state unchanged (same ref) when REST returns nothing — state-honest', async () => {
    const { client } = makeClient({}); // every endpoint → null
    const merge = createRestMerge({ client });
    await merge.poll();
    expect(merge.merge(raceStartState)).toBe(raceStartState);
  });

  it('polls only the VE/aids endpoints (strategyUsage, garage, repairRefuel)', async () => {
    const { client, calls } = makeClient();
    await createRestMerge({ client }).poll();
    expect([...calls].sort()).toEqual(['garage', 'repairRefuel', 'strategyUsage']);
  });

  it('start() arms the ~2 Hz poll once (idempotent); stop() clears it', () => {
    const { client } = makeClient();
    let armed = 0;
    let cleared = 0;
    const merge = createRestMerge({
      client,
      setInterval: () => {
        armed += 1;
        return armed as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        cleared += 1;
      },
    });
    merge.start();
    merge.start(); // idempotent — does not arm a second timer
    expect(armed).toBe(1);
    merge.stop();
    expect(cleared).toBe(1);
  });
});
