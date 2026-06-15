import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { RaceState } from '@race-engineer/core';
import { midStintState } from '@race-engineer/core/fixtures';
import {
  parseReplay,
  synthesizeFrames,
  type SyntheticConfig,
} from '@race-engineer/adapter-sim-replay';

/**
 * Build one green `RaceState` frame per completed lap, with a controllable per-lap fuel drop, so a
 * test can hand the fuel-accuracy eval a stint whose ground-truth consumption it sets exactly
 * (incl. lap-to-lap noise to test the rolling estimator's convergence). Clones a real fixture so
 * every frame stays schema-valid; only the fields the fuel model reads are overridden.
 */
export const burnStintFrames = (opts: {
  startFuelLiters: number;
  /** Consumption (L) of lap i — the drop from boundary i to boundary i+1. */
  perLapLitersSeq: readonly number[];
  lapTimeS?: number;
}): RaceState[] => {
  const lapTimeS = opts.lapTimeS ?? 200;
  const frames: RaceState[] = [];
  let fuel = opts.startFuelLiters;
  for (let lap = 0; lap <= opts.perLapLitersSeq.length; lap += 1) {
    if (lap > 0) fuel -= opts.perLapLitersSeq[lap - 1]!;
    const f = structuredClone(midStintState) as RaceState;
    f.tick = lap;
    f.monotonicMs = lap * lapTimeS * 1000;
    f.player.lapsCompleted = lap;
    f.player.lastLapS = lap >= 1 ? lapTimeS : null;
    f.player.fuel = {
      ...f.player.fuel,
      liters: fuel,
      perLapAvgLiters: null, // no Normalizer seed — test the engine's own rolling estimate
      lapsRemainingEst: null,
    };
    f.player.pit = { ...f.player.pit, inPitLane: false };
    f.flags = { ...f.flags, global: 'green' };
    f.session = { ...f.session, isTimed: true, remainingS: 18960 - lap * lapTimeS };
    frames.push(f);
  }
  return frames;
};

/** A clean multi-lap synthetic stint with exactly `fuelPerLapLiters` burned per lap (ground truth). */
export const syntheticStint = (overrides: Partial<SyntheticConfig> = {}): RaceState[] => {
  const config: SyntheticConfig = {
    trackName: 'Eval Circuit',
    lapDistanceM: 2000,
    baseLapTimeS: 20,
    hz: 2,
    ticks: 400, // 200 s → 10 laps
    startFuelLiters: 40,
    fuelCapacityLiters: 60,
    fuelPerLapLiters: 3,
    tireWearPerLap01: 0.02,
    playerId: 0,
    playerClassId: 'gt3',
    playerClassName: 'GT3',
    playerCarName: 'Eval GT3',
    rivals: [],
    ...overrides,
  };
  return synthesizeFrames(config);
};

/** The committed real LMU recording (Le Mans multi-class slice, T1.5) as canonical frames. */
const REAL_FIXTURE = fileURLToPath(
  new URL('../../../adapters/sim-replay/fixtures/lemans-multiclass.replay.jsonl', import.meta.url),
);
export const loadRealRecording = async (): Promise<RaceState[]> =>
  parseReplay(await readFile(REAL_FIXTURE, 'utf8'));
