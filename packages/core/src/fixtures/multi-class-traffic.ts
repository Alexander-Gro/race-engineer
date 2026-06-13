import type { RaceState } from '../schema';
import { circuitDeLaSarthe, makeCarState, makePlayerCar, makeTire, uniformWheel } from './helpers';

/**
 * Multi-class traffic: the player (LMP2) is about to be lapped by a Hypercar closing from
 * behind (blue flag), while a GTE car runs alongside. Exercises spotter geometry
 * (worldPos / lateralPos / closingRate) and the faster-class-approaching path.
 */

const player = makePlayerCar({
  id: 22,
  position: 8,
  classPosition: 2,
  classId: 'lmp2',
  className: 'LMP2',
  driverName: 'You',
  lapDistanceM: 3000,
  lapsCompleted: 9,
  lastLapS: 218.7,
  bestLapS: 217.2,
  worldPos: { x: 0, y: 0, z: 3000 },
  lateralPos: 0.0,
  fuel: { liters: 55, capacityLiters: 75, perLapAvgLiters: 2.9, lapsRemainingEst: 18.9 },
  tires: uniformWheel(
    makeTire({
      tempC: { inner: 92, center: 89, outer: 86 },
      pressureKpa: 172,
      wear01: 0.78,
      compound: 'medium',
      surfaceTempC: 88,
    }),
  ),
  aids: {
    tc: { value: 6, min: 0, max: 11 },
    abs: { value: 4, min: 0, max: 11 },
    brakeBias: { frontPct: 55.0 },
  },
  engine: { rpm: 7600, maxRpm: 8600, gear: 5, map: 4 },
  car: { name: 'Oreca 07', classId: 'lmp2', className: 'LMP2' },
  setupSummary: null,
});

export const multiClassTrafficState = {
  tick: 64980,
  monotonicMs: 1083000,
  session: {
    game: 'lmu',
    phase: 'race',
    isTimed: true,
    elapsedS: 1980,
    remainingS: 19620,
    totalLaps: null,
    serverName: 'Endurance Server #1',
    multiClass: true,
  },
  player,
  cars: [
    // Hypercar leader, far up the road.
    makeCarState({
      id: 1,
      position: 1,
      classPosition: 1,
      classId: 'hypercar',
      className: 'Hypercar',
      driverName: 'Leader',
      lapDistanceM: 8200,
      lapsCompleted: 10,
      lastLapS: 209.4,
      gapToPlayerS: -94.0,
      gapToPlayerM: -8000,
    }),
    // Hypercar closing from behind to lap the player (blue-flag situation).
    makeCarState({
      id: 4,
      position: 3,
      classPosition: 3,
      classId: 'hypercar',
      className: 'Hypercar',
      driverName: 'Lapper',
      lapDistanceM: 2975,
      lapsCompleted: 9,
      lastLapS: 210.0,
      worldPos: { x: -1.6, y: 0, z: 2975 },
      lateralPos: -1.6,
      gapToPlayerS: 0.8,
      gapToPlayerM: 25,
      closingRateMps: 12.5,
    }),
    player,
    // GTE car running side-by-side with the player.
    makeCarState({
      id: 31,
      position: 9,
      classPosition: 1,
      classId: 'gte',
      className: 'GTE',
      driverName: 'GT Battle',
      lapDistanceM: 3001,
      lapsCompleted: 9,
      lastLapS: 226.3,
      worldPos: { x: 2.1, y: 0, z: 3001 },
      lateralPos: 2.1,
      gapToPlayerS: 0.0,
      gapToPlayerM: 1,
      closingRateMps: 0.3,
    }),
  ],
  track: circuitDeLaSarthe({ surfaceTempC: 32 }),
  weather: {
    airTempC: 24,
    trackTempC: 32,
    rainIntensity01: 0,
    wetness01: 0,
    forecast: null,
  },
  flags: { global: 'green', sectorYellows: null, blueForPlayer: true },
} satisfies RaceState;
