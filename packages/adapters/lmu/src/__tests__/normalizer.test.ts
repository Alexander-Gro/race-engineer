import { RaceStateSchema } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import { createLmuNormalizer } from '../normalizer';
import { KELVIN } from '../shm/structs';
import type {
  RawScoringInfo,
  RawVehicleScoring,
  RawVehicleTelemetry,
  RawWheel,
  TelemetryFrame,
} from '../shm/structs';
import type { LmuRawFrame } from '../types';

const wheel = (o: Partial<RawWheel> = {}): RawWheel => ({
  brakeTempK: o.brakeTempK ?? KELVIN + 60,
  pressureKpa: o.pressureKpa ?? 166,
  tempK: o.tempK ?? [KELVIN + 90, KELVIN + 88, KELVIN + 86],
  wear: o.wear ?? 1.0,
});

const vt = (
  o: Partial<RawVehicleTelemetry> & Pick<RawVehicleTelemetry, 'id'>,
): RawVehicleTelemetry => ({
  id: o.id,
  gear: o.gear ?? 6,
  engineRPM: o.engineRPM ?? 6960,
  engineMaxRPM: o.engineMaxRPM ?? 9400,
  fuel: o.fuel ?? 84,
  fuelCapacity: o.fuelCapacity ?? 117,
  waterTempC: o.waterTempC ?? 75,
  oilTempC: o.oilTempC ?? 90,
  rearBrakeBias: o.rearBrakeBias ?? 0.48,
  frontTireCompound: o.frontTireCompound ?? 'Soft',
  rearTireCompound: o.rearTireCompound ?? 'Medium',
  speedMps: o.speedMps ?? 60,
  wheels: o.wheels ?? [wheel(), wheel(), wheel(), wheel()],
});

const vs = (
  o: Partial<RawVehicleScoring> & Pick<RawVehicleScoring, 'id' | 'place' | 'vehicleClass'>,
): RawVehicleScoring => ({
  id: o.id,
  place: o.place,
  isPlayer: o.isPlayer ?? false,
  driverName: o.driverName ?? 'Driver',
  vehicleClass: o.vehicleClass,
  totalLaps: o.totalLaps ?? 10,
  lapDistM: o.lapDistM ?? 0,
  pathLateral: o.pathLateral ?? 0,
  timeBehindNext: o.timeBehindNext ?? 0,
  timeBehindLeader: o.timeBehindLeader ?? 0,
  lapsBehindLeader: o.lapsBehindLeader ?? 0,
  bestLapTime: o.bestLapTime ?? -1,
  lastLapTime: o.lastLapTime ?? 0,
  numPitstops: o.numPitstops ?? 0,
  inPits: o.inPits ?? false,
  pitState: o.pitState ?? 0,
  underYellow: o.underYellow ?? false,
  flag: o.flag ?? 0,
});

const info = (o: Partial<RawScoringInfo> = {}): RawScoringInfo => ({
  trackName: o.trackName ?? 'Circuit de la Sarthe',
  session: o.session ?? 5,
  currentET: o.currentET ?? 165,
  endET: o.endET ?? 0,
  maxLaps: o.maxLaps ?? 0,
  trackLengthM: o.trackLengthM ?? 13624,
  numVehicles: o.numVehicles ?? 4,
  gamePhase: o.gamePhase ?? 5,
  yellowFlagState: o.yellowFlagState ?? 0,
  sectorFlag: o.sectorFlag ?? [1, 11, 1],
  ambientTempC: o.ambientTempC ?? 22,
  trackTempC: o.trackTempC ?? 43,
});

const frame = (o: {
  tick?: number;
  monotonicMs?: number;
  info?: RawScoringInfo;
  vehicles: RawVehicleScoring[];
  telemetry?: TelemetryFrame | null;
}): LmuRawFrame => ({
  tick: o.tick ?? 0,
  monotonicMs: o.monotonicMs ?? 1000,
  scoring: { info: o.info ?? info(), vehicles: o.vehicles },
  telemetry: o.telemetry === undefined ? { numVehicles: 0, vehicles: [] } : o.telemetry,
});

/** A small multi-class grid: Hyper leader, an LMP2, a GT3 rival behind, the player (GT3). */
const grid = (): RawVehicleScoring[] => [
  vs({
    id: 1,
    place: 1,
    vehicleClass: 'Hyper',
    lapDistM: 5000,
    timeBehindLeader: 0,
    lastLapTime: 210,
    bestLapTime: 209,
    pathLateral: 1,
  }),
  vs({
    id: 18,
    place: 2,
    vehicleClass: 'LMP2',
    lapDistM: 4000,
    timeBehindLeader: 30,
    pathLateral: 0.5,
  }),
  vs({
    id: 34,
    place: 3,
    vehicleClass: 'GT3',
    lapDistM: 2900,
    timeBehindLeader: 65,
    pathLateral: -1,
  }),
  vs({
    id: 53,
    place: 4,
    vehicleClass: 'GT3',
    isPlayer: true,
    lapDistM: 3000,
    timeBehindLeader: 60,
    pathLateral: 2,
  }),
];

const playerTelemetry = (o: Partial<RawVehicleTelemetry> = {}): TelemetryFrame => ({
  numVehicles: 1,
  vehicles: [vt({ id: 53, ...o })],
});

describe('createLmuNormalizer', () => {
  it('maps a multi-class raw frame to a schema-valid RaceState', () => {
    const state = createLmuNormalizer().toRaceState(
      frame({ vehicles: grid(), telemetry: playerTelemetry() }),
    );

    expect(() => RaceStateSchema.parse(state)).not.toThrow();
    expect(state.session.game).toBe('lmu');
    expect(state.session.phase).toBe('race'); // gamePhase 5
    expect(state.session.multiClass).toBe(true);
    expect(state.cars.map((c) => c.className)).toEqual(['Hyper', 'LMP2', 'GT3', 'GT3']);
    expect(state.cars[0]?.classId).toBe('hyper');
    expect(state.cars[0]?.lateralPos).toBe(1);
  });

  it('maps player telemetry with correct units (K→°C), wheel order, and aids', () => {
    const state = createLmuNormalizer().toRaceState(
      frame({ vehicles: grid(), telemetry: playerTelemetry() }),
    );
    const p = state.player;

    expect(p.className).toBe('GT3');
    expect(p.fuel.liters).toBe(84);
    expect(p.fuel.capacityLiters).toBe(117);
    const fl = p.tires[0].tempC as { inner: number; center: number; outer: number };
    expect(fl.inner).toBeCloseTo(90); // Kelvin → °C
    expect(fl.outer).toBeCloseTo(86);
    expect(p.tires[0].wear01).toBe(1); // 1.0 = new
    expect(p.tires[0].compound).toBe('Soft'); // FL = front
    expect(p.tires[2].compound).toBe('Medium'); // RL = rear
    expect(p.brakes[0].discTempC).toBeCloseTo(60);
    expect(p.engine).toMatchObject({ rpm: 6960, maxRpm: 9400, gear: 6 });
    expect(p.aids.brakeBias.frontPct).toBeCloseTo(48);
    expect(p.aids.tc).toBeNull(); // not in SHM
    expect(p.lastLapS).toBeNull(); // 0 sentinel → null
  });

  it('computes gaps relative to the player (+ behind, − ahead)', () => {
    const state = createLmuNormalizer().toRaceState(
      frame({ vehicles: grid(), telemetry: playerTelemetry() }),
    );
    const leader = state.cars.find((c) => c.id === 1);
    const behind = state.cars.find((c) => c.id === 34);
    expect(leader?.gapToPlayerS).toBeLessThan(0); // ahead
    expect(leader?.gapToPlayerM ?? 0).toBeLessThan(0);
    expect(behind?.gapToPlayerS).toBeGreaterThan(0); // behind
    expect(behind?.gapToPlayerM ?? 0).toBeGreaterThan(0);
    expect(state.cars.find((c) => c.isPlayer)?.gapToPlayerS).toBeNull();
  });

  it('derives closing rate and rolling fuel across consecutive frames', () => {
    const n = createLmuNormalizer();
    n.toRaceState(
      frame({
        tick: 0,
        monotonicMs: 1000,
        vehicles: [
          vs({
            id: 53,
            place: 1,
            vehicleClass: 'GT3',
            isPlayer: true,
            lapDistM: 3000,
            totalLaps: 10,
          }),
          vs({ id: 34, place: 2, vehicleClass: 'GT3', lapDistM: 2900 }),
        ],
        telemetry: playerTelemetry({ fuel: 84 }),
      }),
    );
    const b = n.toRaceState(
      frame({
        tick: 1,
        monotonicMs: 2000, // +1 s
        vehicles: [
          vs({
            id: 53,
            place: 1,
            vehicleClass: 'GT3',
            isPlayer: true,
            lapDistM: 3000,
            totalLaps: 11,
          }),
          vs({ id: 34, place: 2, vehicleClass: 'GT3', lapDistM: 2950 }), // closed 50 m
        ],
        telemetry: playerTelemetry({ fuel: 81.4 }), // used 2.6 over the lap
      }),
    );

    expect(b.cars.find((c) => c.id === 34)?.closingRateMps).toBeCloseTo(50);
    expect(b.player.fuel.perLapAvgLiters).toBeCloseTo(2.6);
    expect(b.player.fuel.lapsRemainingEst).toBeCloseTo(81.4 / 2.6);
  });

  it('maps phase/flags and a timed race', () => {
    const checkered = createLmuNormalizer().toRaceState(
      frame({ info: info({ gamePhase: 8 }), vehicles: grid(), telemetry: playerTelemetry() }),
    );
    expect(checkered.session.phase).toBe('checkered');
    expect(checkered.flags.global).toBe('checkered');

    const fcy = createLmuNormalizer().toRaceState(
      frame({
        info: info({ gamePhase: 5, yellowFlagState: 3 }),
        vehicles: grid(),
        telemetry: playerTelemetry(),
      }),
    );
    expect(fcy.flags.global).toBe('fcy');

    const timed = createLmuNormalizer().toRaceState(
      frame({
        info: info({ endET: 3600, currentET: 600 }),
        vehicles: grid(),
        telemetry: playerTelemetry(),
      }),
    );
    expect(timed.session.isTimed).toBe(true);
    expect(timed.session.remainingS).toBe(3000);
  });
});
