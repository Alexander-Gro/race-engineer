import type { RaceState } from '../schema';
import { circuitDeLaSarthe, makeCarState, makePlayerCar, makeTire, uniformWheel } from './helpers';

/**
 * Start of a 6-hour race, a few seconds after the green flag. No per-lap fuel/lap-time data
 * exists yet, so rolling estimates are null — exercises the "cold start" path for strategy.
 */

const player = makePlayerCar({
  id: 7,
  position: 5,
  classPosition: 2,
  classId: 'hypercar',
  className: 'Hypercar',
  driverName: 'You',
  lapDistanceM: 120,
  lapsCompleted: 0,
  worldPos: { x: 0, y: 0, z: 120 },
  lateralPos: 0.2,
  fuel: { liters: 78, capacityLiters: 80, perLapAvgLiters: null, lapsRemainingEst: null },
  tires: uniformWheel(
    makeTire({
      tempC: { inner: 70, center: 66, outer: 62 },
      pressureKpa: 170,
      wear01: 0.99,
      compound: 'medium',
      surfaceTempC: 60,
    }),
  ),
  aids: {
    tc: { value: 4, min: 0, max: 11 },
    abs: { value: 3, min: 0, max: 11 },
    brakeBias: { frontPct: 54.5 },
  },
  engine: { rpm: 6200, maxRpm: 9000, gear: 3, map: 5 },
  car: { name: 'Ferrari 499P', classId: 'hypercar', className: 'Hypercar' },
  setupSummary: {
    name: 'Le Mans — race',
    params: { frontWing: 4, rearWing: 6, coldPressureFL: 165, diffPreload: 'medium' },
  },
});

export const raceStartState = {
  tick: 0,
  monotonicMs: 0,
  session: {
    game: 'lmu',
    phase: 'race',
    isTimed: true,
    elapsedS: 6,
    remainingS: 21600,
    totalLaps: null,
    serverName: null,
    multiClass: true,
  },
  player,
  cars: [
    makeCarState({
      id: 3,
      position: 1,
      classPosition: 1,
      classId: 'hypercar',
      className: 'Hypercar',
      driverName: 'Rival A',
      lapDistanceM: 260,
      worldPos: { x: 3, y: 0, z: 260 },
    }),
    makeCarState({
      id: 5,
      position: 2,
      classPosition: 1,
      classId: 'lmp2',
      className: 'LMP2',
      driverName: 'Rival B',
      lapDistanceM: 220,
    }),
    player,
    makeCarState({
      id: 9,
      position: 12,
      classPosition: 1,
      classId: 'gte',
      className: 'GTE',
      driverName: 'Rival C',
      lapDistanceM: 60,
    }),
  ],
  track: circuitDeLaSarthe(),
  weather: {
    airTempC: 22,
    trackTempC: 30,
    rainIntensity01: 0,
    wetness01: 0,
    forecast: [{ inMinutes: 60, rain01: 0.2 }],
  },
  flags: { global: 'green', sectorYellows: null, blueForPlayer: false },
} satisfies RaceState;
