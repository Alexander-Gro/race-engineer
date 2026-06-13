import type {
  Brake,
  CarState,
  DriverAids,
  PlayerCar,
  Tire,
  TrackState,
  WheelArray,
} from '../schema';

/**
 * Small constructors that fill in canonical-schema defaults so the hand-written fixtures
 * stay readable — each fixture only spells out the fields that matter to its scenario.
 * These are dev/test data only; production frames come from the Normalizer.
 */

export const makeTire = (o: Partial<Tire> = {}): Tire => ({
  tempC: o.tempC ?? 80,
  pressureKpa: o.pressureKpa ?? null,
  wear01: o.wear01 ?? null,
  compound: o.compound ?? null,
  surfaceTempC: o.surfaceTempC ?? null,
});

export const makeBrake = (o: Partial<Brake> = {}): Brake => ({
  discTempC: o.discTempC ?? null,
});

/** Repeat a single value across all four wheels ([FL, FR, RL, RR]). */
export const uniformWheel = <T>(v: T): WheelArray<T> => [v, v, v, v];

const defaultAids: DriverAids = {
  tc: { value: 0, min: 0, max: 11 },
  abs: { value: 0, min: 0, max: 11 },
  brakeBias: { frontPct: 54 },
};

export const makeCarState = (
  o: Partial<CarState> & Pick<CarState, 'id' | 'position'>,
): CarState => ({
  id: o.id,
  isPlayer: o.isPlayer ?? false,
  position: o.position,
  classPosition: o.classPosition ?? null,
  classId: o.classId ?? null,
  className: o.className ?? null,
  driverName: o.driverName ?? null,
  lapDistanceM: o.lapDistanceM ?? 0,
  lapsCompleted: o.lapsCompleted ?? 0,
  lastLapS: o.lastLapS ?? null,
  bestLapS: o.bestLapS ?? null,
  worldPos: o.worldPos ?? null,
  lateralPos: o.lateralPos ?? null,
  pit: o.pit ?? { inPitLane: false, inPitStall: false, stops: 0, state: 'none' },
  gapToPlayerS: o.gapToPlayerS ?? null,
  gapToPlayerM: o.gapToPlayerM ?? null,
  closingRateMps: o.closingRateMps ?? null,
});

export const makePlayerCar = (
  o: Partial<PlayerCar> & Pick<PlayerCar, 'id' | 'position'>,
): PlayerCar => ({
  ...makeCarState({ ...o, isPlayer: true }),
  fuel: o.fuel ?? {
    liters: 0,
    capacityLiters: null,
    perLapAvgLiters: null,
    lapsRemainingEst: null,
  },
  tires: o.tires ?? uniformWheel(makeTire()),
  brakes: o.brakes ?? uniformWheel(makeBrake()),
  aids: o.aids ?? defaultAids,
  inputs: o.inputs ?? { throttle: 0, brake: 0, clutch: 0, steer: 0 },
  engine: o.engine ?? { rpm: 0, maxRpm: null, gear: 0, map: null },
  car: o.car ?? { name: 'Unknown', classId: null, className: null },
  setupSummary: o.setupSummary ?? null,
});

/** A thematic endurance track (Circuit de la Sarthe) shared by the fixtures. */
export const circuitDeLaSarthe = (overrides: Partial<TrackState> = {}): TrackState => ({
  name: 'Circuit de la Sarthe',
  lengthM: 13626,
  sectorBoundariesM: [4400, 9300],
  surfaceTempC: 30,
  gripEstimate: null,
  ...overrides,
});
