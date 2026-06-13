import type { RaceState } from '../schema';
import { circuitDeLaSarthe, makeCarState, makePlayerCar, makeTire } from './helpers';

/**
 * Settled into the first stint (~12 laps in). Rolling fuel rate and lap times are now
 * known, so laps-remaining is derived; tires are mid-wear and up to temperature.
 */

const player = makePlayerCar({
  id: 7,
  position: 4,
  classPosition: 2,
  classId: 'hypercar',
  className: 'Hypercar',
  driverName: 'You',
  lapDistanceM: 5200,
  lapsCompleted: 12,
  lastLapS: 210.4,
  bestLapS: 208.9,
  worldPos: { x: -12, y: 0, z: 5200 },
  lateralPos: -0.1,
  fuel: { liters: 42, capacityLiters: 80, perLapAvgLiters: 3.1, lapsRemainingEst: 13.5 },
  tires: [
    makeTire({
      tempC: { inner: 102, center: 98, outer: 94 },
      pressureKpa: 178,
      wear01: 0.66,
      compound: 'medium',
      surfaceTempC: 95,
    }),
    makeTire({
      tempC: { inner: 100, center: 97, outer: 95 },
      pressureKpa: 179,
      wear01: 0.64,
      compound: 'medium',
      surfaceTempC: 94,
    }),
    makeTire({
      tempC: { inner: 96, center: 93, outer: 90 },
      pressureKpa: 176,
      wear01: 0.71,
      compound: 'medium',
      surfaceTempC: 91,
    }),
    makeTire({
      tempC: { inner: 95, center: 92, outer: 90 },
      pressureKpa: 176,
      wear01: 0.7,
      compound: 'medium',
      surfaceTempC: 90,
    }),
  ],
  aids: {
    tc: { value: 4, min: 0, max: 11 },
    abs: { value: 3, min: 0, max: 11 },
    brakeBias: { frontPct: 54.5 },
  },
  engine: { rpm: 8200, maxRpm: 9000, gear: 6, map: 5 },
  car: { name: 'Ferrari 499P', classId: 'hypercar', className: 'Hypercar' },
  setupSummary: null,
});

export const midStintState = {
  tick: 90360,
  monotonicMs: 1506000,
  session: {
    game: 'lmu',
    phase: 'race',
    isTimed: true,
    elapsedS: 2640,
    remainingS: 18960,
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
      lapDistanceM: 6100,
      lapsCompleted: 12,
      lastLapS: 209.1,
      gapToPlayerS: -28.4,
      gapToPlayerM: -900,
    }),
    player,
    makeCarState({
      id: 8,
      position: 6,
      classPosition: 3,
      classId: 'hypercar',
      className: 'Hypercar',
      driverName: 'Rival D',
      lapDistanceM: 4700,
      lapsCompleted: 12,
      lastLapS: 211.0,
      gapToPlayerS: 9.7,
      gapToPlayerM: 500,
    }),
  ],
  track: circuitDeLaSarthe({ surfaceTempC: 33 }),
  weather: {
    airTempC: 23,
    trackTempC: 33,
    rainIntensity01: 0,
    wetness01: 0,
    forecast: [{ inMinutes: 30, rain01: 0.4 }],
  },
  flags: { global: 'green', sectorYellows: null, blueForPlayer: false },
} satisfies RaceState;
