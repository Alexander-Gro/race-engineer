import { describe, expect, it } from 'vitest';
import { evalFuelAccuracy } from '../fuel-accuracy';
import { burnStintFrames, loadFuelStint, loadRealRecording, syntheticStint } from './helpers';

describe('evalFuelAccuracy — clean synthetic stint (known ground truth)', () => {
  it('recovers the exact per-lap burn and is within ±1 lap from mid-stint (docs/10 Phase-2 gate)', () => {
    const frames = syntheticStint({ fuelPerLapLiters: 3, startFuelLiters: 40 });
    const result = evalFuelAccuracy(frames);

    expect(result.silent).toBe(false);
    expect(result.completedGreenLaps).toBeGreaterThanOrEqual(5);
    // The synthetic source burns exactly 3 L/lap → the eval recovers it from the recording.
    expect(result.groundTruthPerLapLiters).toBeCloseTo(3, 5);
    // The model recovers a noiseless rate immediately → every prediction is essentially exact.
    expect(result.withinToleranceByMidStint).toBe(true);
    expect(result.midStintMaxLapsErrorAbs).toBeLessThanOrEqual(1);
    expect(result.maxConfidence01).toBeGreaterThan(0.5);
    for (const s of result.samples) {
      expect(s.predictedPerLapLiters).toBeCloseTo(3, 5);
      expect(Number.isFinite(s.actualLapsRemainingOnFuel)).toBe(true);
    }
  });
});

describe('evalFuelAccuracy — noisy stint (rolling estimator must converge)', () => {
  it('is off early but converges within ±1 lap by mid-stint despite lap-to-lap noise', () => {
    // A noisy opening (3.6/3.4/2.6/2.4) that settles to 3.0; the robust (median) estimator is
    // skewed high on the first laps, then converges as the window fills (mean 3.0 L/lap).
    const perLapLitersSeq = [3.6, 3.4, 2.6, 2.4, 3.0, 3.0, 3.0, 3.0];
    const frames = burnStintFrames({ startFuelLiters: 40, perLapLitersSeq });
    const result = evalFuelAccuracy(frames);

    expect(result.silent).toBe(false);
    expect(result.completedGreenLaps).toBe(perLapLitersSeq.length);
    expect(result.groundTruthPerLapLiters).toBeCloseTo(3.0, 5);
    // Genuinely off early (the first estimate is wrong by > 1 lap)…
    expect(result.samples[0]?.lapsRemainingErrorAbs ?? 0).toBeGreaterThan(1);
    // …but converged within ±1 lap from mid-stint onward — the docs/10 Phase-2 gate.
    expect(result.withinToleranceByMidStint).toBe(true);
    expect(result.midStintMaxLapsErrorAbs).toBeLessThanOrEqual(1);
  });

  it('flags a stint that has NOT converged by mid-stint (the gate measures real error)', () => {
    // A volatile 3-lap stint (3 → 4 → 2 L) whose mid-stint estimate is still > 1 lap off.
    const frames = burnStintFrames({ startFuelLiters: 40, perLapLitersSeq: [3.0, 4.0, 2.0] });
    const result = evalFuelAccuracy(frames);
    expect(result.groundTruthPerLapLiters).toBeCloseTo(3.0, 5);
    expect(result.withinToleranceByMidStint).toBe(false);
    expect(result.midStintMaxLapsErrorAbs ?? 0).toBeGreaterThan(1);
  });
});

describe('evalFuelAccuracy — honesty on a flat-fuel real recording (docs/05 §8)', () => {
  it('stays silent on the real Le Mans slice (no completed laps / no burn) — no fabricated rate', async () => {
    const frames = await loadRealRecording();
    const result = evalFuelAccuracy(frames);
    // The committed slice is a 60-frame side-by-side window: fuel is flat and no lap completes, so
    // the model MUST produce no estimate rather than invent one.
    expect(result.silent).toBe(true);
    expect(result.groundTruthPerLapLiters).toBeNull();
    expect(result.samples).toEqual([]);
    expect(result.withinToleranceByMidStint).toBe(true); // vacuously — nothing to be wrong about
  });
});

describe('evalFuelAccuracy — real recorded stint WITH fuel burn (T1.5)', () => {
  it('is non-silent and recovers a realistic per-lap burn from genuine GT3 telemetry', async () => {
    // A real GT3 stint captured with fuel consumption ON (downsampled fixture). The first time the
    // eval runs against genuine fuel burn rather than synthetic ground truth — so we assert the
    // honesty + recovery it CAN prove on this short capture.
    const frames = await loadFuelStint();
    const result = evalFuelAccuracy(frames);

    expect(result.silent).toBe(false); // fuel really burns here, unlike the flat slice above
    expect(result.completedGreenLaps).toBe(3);
    // Recovers a sane GT3 burn (~3 L/lap) from the recording's own lap-boundary drops — no fabrication.
    expect(result.groundTruthPerLapLiters).toBeGreaterThan(2);
    expect(result.groundTruthPerLapLiters).toBeLessThan(4);

    // NOTE: this stint is only 3 laps (one a standing-start partial), so it does NOT yet pass the
    // docs/10 ±1-lap-by-mid-stint *convergence* gate — the rolling estimator needs more clean green
    // laps to settle. Closing that headline gate on real data still wants a ≥5-lap green stint
    // (rig backlog, docs/03). Here we lock in the non-silent + sane-rate behaviour only.
    expect(result.withinToleranceByMidStint).toBe(false);
  });
});
