import type { RaceState } from '../schema';
import { circuitDeLaSarthe, makeCarState, makePlayerCar, makeTire } from './helpers';

/**
 * End of the stint with under two laps of fuel left — the trigger state for a `fuel_low`
 * call-out and a "box this lap" decision. Tires are well worn.
 */

const player = makePlayerCar({
  id: 7,
  position: 4,
  classPosition: 2,
  classId: 'hypercar',
  className: 'Hypercar',
  driverName: 'You',
  lapDistanceM: 8800,
  lapsCompleted: 28,
  lastLapS: 211.8,
  bestLapS: 208.9,
  worldPos: { x: 5, y: 0, z: 8800 },
  lateralPos: 0.05,
  // 3.4 L at 3.2 L/lap => ~1.06 laps remaining: under two laps.
  fuel: { liters: 3.4, capacityLiters: 80, perLapAvgLiters: 3.2, lapsRemainingEst: 1.06 },
  tires: [
    makeTire({
      tempC: { inner: 104, center: 99, outer: 95 },
      pressureKpa: 181,
      wear01: 0.38,
      compound: 'medium',
      surfaceTempC: 97,
    }),
    makeTire({
      tempC: { inner: 103, center: 99, outer: 96 },
      pressureKpa: 182,
      wear01: 0.36,
      compound: 'medium',
      surfaceTempC: 96,
    }),
    makeTire({
      tempC: { inner: 97, center: 94, outer: 91 },
      pressureKpa: 178,
      wear01: 0.44,
      compound: 'medium',
      surfaceTempC: 92,
    }),
    makeTire({
      tempC: { inner: 96, center: 94, outer: 91 },
      pressureKpa: 178,
      wear01: 0.43,
      compound: 'medium',
      surfaceTempC: 92,
    }),
  ],
  aids: {
    tc: { value: 5, min: 0, max: 11 },
    abs: { value: 3, min: 0, max: 11 },
    brakeBias: { frontPct: 54.0 },
  },
  engine: { rpm: 8100, maxRpm: 9000, gear: 6, map: 3 },
  car: { name: 'Ferrari 499P', classId: 'hypercar', className: 'Hypercar' },
  setupSummary: null,
});

export const lowFuelState = {
  tick: 211200,
  monotonicMs: 3520000,
  session: {
    game: 'lmu',
    phase: 'race',
    isTimed: true,
    elapsedS: 6160,
    remainingS: 15440,
    totalLaps: null,
    serverName: null,
    multiClass: true,
  },
  player,
  cars: [
    player,
    makeCarState({
      id: 8,
      position: 5,
      classPosition: 3,
      classId: 'hypercar',
      className: 'Hypercar',
      driverName: 'Rival D',
      lapDistanceM: 8500,
      lapsCompleted: 28,
      lastLapS: 210.2,
      gapToPlayerS: 6.1,
      gapToPlayerM: 300,
      closingRateMps: 1.1,
    }),
  ],
  track: circuitDeLaSarthe({ surfaceTempC: 31 }),
  weather: {
    airTempC: 21,
    trackTempC: 31,
    rainIntensity01: 0,
    wetness01: 0,
    forecast: null,
  },
  flags: { global: 'green', sectorYellows: null, blueForPlayer: false },
} satisfies RaceState;
