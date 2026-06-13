import { describe, expect, it } from 'vitest';
import type { AdapterCapabilities, GameAdapter, Unsubscribe } from '../adapter';
import type { Normalizer } from '../normalize';
import { createCanonicalNormalizer } from '../normalize';
import { runPipeline } from '../pipeline';
import type { RaceState } from '../schema';
import { lowFuelState, midStintState, raceStartState } from '../fixtures';

/** Minimal in-memory adapter that emits a fixed frame list — keeps core tests dependency-free. */
class FakeAdapter implements GameAdapter<RaceState> {
  readonly id = 'fake';
  readonly #frames: readonly RaceState[];
  readonly #listeners = new Set<(frame: RaceState) => void>();

  constructor(frames: readonly RaceState[]) {
    this.#frames = frames;
  }

  capabilities(): AdapterCapabilities {
    return {
      hasSharedMemory: false,
      hasRestApi: false,
      readsCurrentAids: false,
      readsSetup: false,
      exposesTireCompound: false,
      fields: new Set<string>(),
    };
  }

  onFrame(cb: (frame: RaceState) => void): Unsubscribe {
    this.#listeners.add(cb);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  async start(): Promise<void> {
    for (const frame of this.#frames) {
      for (const listener of this.#listeners) listener(frame);
    }
  }

  async stop(): Promise<void> {}
}

const passthrough: Normalizer<RaceState> = { toRaceState: (frame) => frame };

describe('runPipeline', () => {
  it('streams every frame through the normalizer to onState, in order', async () => {
    const frames = [raceStartState, midStintState, lowFuelState];
    const seen: number[] = [];
    await runPipeline({
      adapter: new FakeAdapter(frames),
      normalizer: passthrough,
      onState: (state) => seen.push(state.tick),
    });
    expect(seen).toEqual(frames.map((f) => f.tick));
  });

  it('applies the normalizer (derived rolling fuel-per-lap appears downstream)', async () => {
    const frames = [raceStartState, midStintState];
    const perLap: (number | null)[] = [];
    await runPipeline({
      adapter: new FakeAdapter(frames),
      normalizer: createCanonicalNormalizer(),
      onState: (state) => perLap.push(state.player.fuel.perLapAvgLiters),
    });
    expect(perLap[0]).toBeNull(); // first frame: no lap observed yet
    expect(perLap[1]).not.toBeNull(); // a lap boundary was crossed -> estimate appears
  });

  it('drops torn frames via the guard hook and reports them', async () => {
    const frames = [raceStartState, midStintState, lowFuelState];
    const seen: number[] = [];
    const dropped: number[] = [];
    await runPipeline({
      adapter: new FakeAdapter(frames),
      normalizer: passthrough,
      isFrameStable: (frame) => frame.tick !== midStintState.tick,
      onState: (state) => seen.push(state.tick),
      onDroppedFrame: (frame) => dropped.push(frame.tick),
    });
    expect(seen).toEqual([raceStartState.tick, lowFuelState.tick]);
    expect(dropped).toEqual([midStintState.tick]);
  });
});
