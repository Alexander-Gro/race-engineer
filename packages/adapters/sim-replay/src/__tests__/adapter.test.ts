import { describe, expect, it } from 'vitest';
import type { RaceState } from '@race-engineer/core';
import { SimReplayAdapter, replayAdapter, syntheticAdapter } from '../adapter';
import { scriptedScenario, synthesizeFrames } from '../synthetic';

describe('SimReplayAdapter', () => {
  it('emits the frame sequence in order to subscribers (deterministic stream)', async () => {
    const frames = synthesizeFrames(scriptedScenario());
    const adapter = replayAdapter(frames);
    const received: RaceState[] = [];
    const unsubscribe = adapter.onFrame((f) => received.push(f));

    await adapter.start();
    unsubscribe();

    expect(received).toEqual(frames);
    expect(adapter.frameCount).toBe(frames.length);
  });

  it('reports read-only sim-replay capabilities and its id', () => {
    const adapter = syntheticAdapter(scriptedScenario());
    const caps = adapter.capabilities();

    expect(caps.hasSharedMemory).toBe(false);
    expect(caps.hasRestApi).toBe(false);
    expect(caps.readsCurrentAids).toBe(true);
    expect(caps.fields.size).toBeGreaterThan(0);
    expect(adapter.id).toBe('synthetic');
  });

  it('does not emit to a listener that unsubscribed before start()', async () => {
    const frames = synthesizeFrames(scriptedScenario());
    const adapter = new SimReplayAdapter({ frames });
    const received: RaceState[] = [];
    const unsubscribe = adapter.onFrame((f) => received.push(f));

    unsubscribe();
    await adapter.start();

    expect(received).toHaveLength(0);
  });
});
