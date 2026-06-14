import { RaceStateSchema } from '@race-engineer/core';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import { describe, expect, it } from 'vitest';
import { createSyntheticEngineerCore } from './host';

describe('createSyntheticEngineerCore (desktop worker wiring)', () => {
  it('drives the synthetic source and ships throttled, schema-valid snapshots to the transport', async () => {
    const snaps: EngineerSnapshot[] = [];
    const core = createSyntheticEngineerCore((s) => snaps.push(s), { snapshotHz: 12 });
    await core.start();

    expect(snaps.length).toBeGreaterThan(0);
    expect(core.snapshotsSent).toBe(snaps.length);
    // The renderer receives canonical, schema-valid state — no game, no Electron.
    expect(RaceStateSchema.safeParse(snaps[0]!.raceState).success).toBe(true);
    expect(snaps.at(-1)!.monotonicMs).toBeGreaterThan(snaps[0]!.monotonicMs);
  });
});
