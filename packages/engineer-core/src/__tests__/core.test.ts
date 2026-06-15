import { createCanonicalNormalizer, RaceStateSchema, type RaceState } from '@race-engineer/core';
import { raceStartState } from '@race-engineer/core/fixtures';
import {
  replayAdapter,
  syntheticAdapter,
  scriptedScenario,
} from '@race-engineer/adapter-sim-replay';
import { describe, expect, it } from 'vitest';
import { EngineerCore } from '../core';
import type { EngineerSnapshot } from '../ipc';

const frameAt = (monotonicMs: number, tick: number): RaceState => ({
  ...raceStartState,
  monotonicMs,
  tick,
});

const collect = async (frames: RaceState[], snapshotHz: number): Promise<EngineerSnapshot[]> => {
  const snaps: EngineerSnapshot[] = [];
  const core = new EngineerCore({
    adapter: replayAdapter(frames),
    normalizer: createCanonicalNormalizer(),
    transport: (s) => snaps.push(s),
    snapshotHz,
  });
  await core.start();
  return snaps;
};

describe('EngineerCore', () => {
  it('drives the pipeline and throttles snapshots to ~snapshotHz with dense sequence numbers', async () => {
    // 10 frames at 60 Hz (~16.7 ms apart): 0,17,33,50,67,83,100,117,133,150 ms.
    const frames = Array.from({ length: 10 }, (_, i) => frameAt(Math.round((i * 1000) / 60), i));
    const snaps = await collect(frames, 15); // ~66.7 ms interval

    expect(snaps[0]!.monotonicMs).toBe(0); // first frame always emitted
    expect(snaps.length).toBeLessThan(frames.length); // genuinely throttled
    expect(snaps.map((s) => s.seq)).toEqual(snaps.map((_, i) => i)); // dense, gapless seq
    // ~66 ms spacing on the sampled clock.
    for (let i = 1; i < snaps.length; i += 1) {
      expect(snaps[i]!.monotonicMs - snaps[i - 1]!.monotonicMs).toBeGreaterThanOrEqual(66);
    }
  });

  it('flushes the final state even when it falls inside a throttle window', async () => {
    // 0, 10, 20 ms — only the first clears a 66 ms window; the last must still be flushed.
    const frames = [frameAt(0, 0), frameAt(10, 1), frameAt(20, 2)];
    const snaps = await collect(frames, 15);
    expect(snaps.map((s) => s.monotonicMs)).toEqual([0, 20]);
  });

  it('emits a schema-valid RaceState in every snapshot (driven by the synthetic source)', async () => {
    const snaps: EngineerSnapshot[] = [];
    const core = new EngineerCore({
      adapter: syntheticAdapter(scriptedScenario()),
      normalizer: createCanonicalNormalizer(),
      transport: (s) => snaps.push(s),
      snapshotHz: 12,
    });
    await core.start();

    expect(snaps.length).toBeGreaterThan(0);
    expect(core.snapshotsSent).toBe(snaps.length);
    for (const snap of snaps) {
      expect(RaceStateSchema.safeParse(snap.raceState).success).toBe(true);
      expect(snap.monotonicMs).toBe(snap.raceState.monotonicMs);
    }
    // Snapshots advance through the session (the source spans a multi-lap stint).
    expect(snaps.at(-1)!.monotonicMs).toBeGreaterThan(snaps[0]!.monotonicMs);
  });

  it('attaches a live fuel plan to snapshots once consumption is learned (always-on strategy)', async () => {
    const snaps: EngineerSnapshot[] = [];
    const core = new EngineerCore({
      adapter: syntheticAdapter(scriptedScenario()),
      normalizer: createCanonicalNormalizer(),
      transport: (s) => snaps.push(s),
      snapshotHz: 12,
    });
    await core.start();

    const planned = snaps.filter((s) => s.strategy?.fuelPlan != null);
    expect(planned.length).toBeGreaterThan(0); // the stint burns fuel → a plan emerges
    const plan = planned.at(-1)!.strategy!.fuelPlan!;
    expect(plan.perLapLiters).toBeGreaterThan(0);
    expect(plan.lapsRemainingOnFuel).toBeGreaterThan(0);
    expect(plan.confidence01).toBeGreaterThanOrEqual(0);
    expect(plan.confidence01).toBeLessThanOrEqual(1);
    // The timed synthetic session also yields a fuel-bound stint plan once consumption is known.
    expect(snaps.some((s) => s.strategy?.stintPlan != null)).toBe(true);
  });

  it('runs the event detector and attaches fired events to snapshots (synthetic stint)', async () => {
    const snaps: EngineerSnapshot[] = [];
    const core = new EngineerCore({
      adapter: syntheticAdapter(scriptedScenario()),
      normalizer: createCanonicalNormalizer(),
      transport: (s) => snaps.push(s),
      snapshotHz: 12,
    });
    await core.start();

    const types = new Set(snaps.flatMap((s) => s.events ?? []).map((e) => e.type));
    expect(types.size).toBeGreaterThan(0);
    expect(types.has('lap_completed')).toBe(true); // the stint completes multiple laps
  });

  it('emits no events when detection is disabled (eventRules: [])', async () => {
    const snaps: EngineerSnapshot[] = [];
    const core = new EngineerCore({
      adapter: syntheticAdapter(scriptedScenario()),
      normalizer: createCanonicalNormalizer(),
      transport: (s) => snaps.push(s),
      snapshotHz: 12,
      eventRules: [],
    });
    await core.start();
    expect(snaps.every((s) => s.events === undefined)).toBe(true);
  });
});
