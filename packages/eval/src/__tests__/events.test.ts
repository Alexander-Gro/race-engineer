import { describe, expect, it } from 'vitest';
import { evalEventCorrectness } from '../events';
import { loadRealRecording, syntheticStint } from './helpers';

describe('evalEventCorrectness — synthetic multi-lap stint', () => {
  it('emits exactly one lap_completed per lap boundary and well-formed events', () => {
    const frames = syntheticStint();
    const result = evalEventCorrectness(frames);

    expect(result.actualLapBoundaries).toBeGreaterThan(0);
    expect(result.lapMarkersMatch).toBe(true);
    expect(result.lapCompletedEvents).toBe(result.actualLapBoundaries);
    expect(result.allWellFormed).toBe(true);
    expect(result.malformed).toEqual([]);
    // The cooldown/dedupe framework keeps per-tick output bounded — no event storm.
    expect(result.maxEventsPerTick).toBeLessThanOrEqual(6);
  });
});

describe('evalEventCorrectness — real LMU recording (Le Mans multi-class)', () => {
  it('produces only well-formed events on genuine telemetry', async () => {
    const frames = await loadRealRecording();
    const result = evalEventCorrectness(frames);

    expect(result.totalEvents).toBeGreaterThan(0);
    expect(result.allWellFormed).toBe(true);
    expect(result.malformed).toEqual([]);
    expect(result.maxEventsPerTick).toBeLessThanOrEqual(6);
  });

  it('keeps the lap marker honest — the slice completes no lap, so no lap_completed fires', async () => {
    const frames = await loadRealRecording();
    const result = evalEventCorrectness(frames);
    expect(result.actualLapBoundaries).toBe(0);
    expect(result.lapCompletedEvents).toBe(0);
    expect(result.lapMarkersMatch).toBe(true);
  });

  it('surfaces real side-by-side spotter call-outs (the window is centred on a 0.0 m moment)', async () => {
    const frames = await loadRealRecording();
    const result = evalEventCorrectness(frames);
    const sides = (result.countsByType.car_left ?? 0) + (result.countsByType.car_right ?? 0);
    expect(sides).toBeGreaterThan(0);
  });
});
