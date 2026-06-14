import {
  kelvinToCelsius,
  type Brake,
  type CarState,
  type FlagState,
  type Normalizer,
  type PitState,
  type PlayerCar,
  type RaceState,
  type SessionState,
  type Tire,
  type WheelArray,
  RollingFuel,
} from '@race-engineer/core';
import type { RawVehicleScoring, RawVehicleTelemetry, RawWheel } from './shm/structs';
import type { LmuRawFrame } from './types';

/**
 * LMU Normalizer (build-plan T2.3): converts the adapter's raw `LmuRawFrame` (rF2 shared-memory
 * structs) into the canonical {@link RaceState} (docs/04). This is the **only** place rF2 field
 * names and units cross into the canonical schema (CLAUDE.md rule 3). Pure mapping + a little
 * Normalizer-owned derived state (rolling fuel-per-lap, frame-to-frame closing rate); inputs are
 * never mutated. Read-only — it produces state, never touches the game.
 *
 * Field/unit conventions confirmed live on the rig (docs/03 §"S1 — live confirmation" #1/#2):
 * tyre & brake temps are Kelvin → °C; fuel litres; pressure kPa; wear 1.0 = new; class strings
 * are `Hyper` / `LMP2` / `GT3`; lap times `-1`/`0` are "no lap yet" sentinels → null.
 *
 * Not yet sourced from shared memory (filled when REST/T2.2 or a decoder extension lands):
 * current TC/ABS/engine-map indices (aids.tc/abs/engine.map = null), driver inputs (0),
 * car model name, world position, sector-yellow detail. Brake-bias front-vs-rear is flagged
 * for HUD confirmation (docs/03).
 */

export interface LmuNormalizerOptions {
  /** Rolling fuel window in laps (default 5). */
  fuelWindowLaps?: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** rF2 `mGamePhase` → canonical session phase (session *type* needs REST; see docs/03). */
const mapPhase = (gamePhase: number): SessionState['phase'] => {
  switch (gamePhase) {
    case 0:
      return 'garage';
    case 2:
    case 3:
    case 4:
      return 'formation';
    case 5:
    case 6:
      return 'race';
    case 8:
      return 'checkered';
    default:
      return 'unknown';
  }
};

/** rF2 `mGamePhase` + `mYellowFlagState` → canonical global flag. */
const mapGlobalFlag = (gamePhase: number, yellowFlagState: number): FlagState['global'] => {
  if (gamePhase === 8) return 'checkered';
  if (yellowFlagState > 0 || gamePhase === 6) return 'fcy';
  if (gamePhase === 5) return 'green';
  return 'none';
};

const PIT_STATES: readonly PitState[] = ['none', 'requested', 'entering', 'stopped', 'exiting'];
const mapPitState = (n: number): PitState => PIT_STATES[n] ?? 'none';

/** Lap-time sentinels (`-1` / `0` = no lap yet) → null. */
const lapTime = (t: number): number | null => (t > 0 ? t : null);

/** Signed along-track gap (m), wrapped to nearest; + = the other car is behind the player. */
const alongTrackGap = (playerDist: number, carDist: number, trackLen: number): number => {
  let d = playerDist - carDist;
  if (trackLen > 0) {
    d = ((d % trackLen) + trackLen) % trackLen;
    if (d > trackLen / 2) d -= trackLen;
  }
  return d;
};

const classId = (cls: string): string | null => (cls ? cls.toLowerCase() : null);

const baseCarState = (v: RawVehicleScoring): CarState => ({
  id: v.id,
  isPlayer: v.isPlayer,
  position: v.place,
  classPosition: null, // not in SHM — derived later / from REST
  classId: classId(v.vehicleClass),
  className: v.vehicleClass || null,
  driverName: v.driverName || null,
  lapDistanceM: v.lapDistM,
  lapsCompleted: v.totalLaps,
  lastLapS: lapTime(v.lastLapTime),
  bestLapS: lapTime(v.bestLapTime),
  worldPos: null, // mPos not decoded yet
  lateralPos: v.pathLateral,
  pit: {
    inPitLane: v.inPits,
    inPitStall: false, // mInGarageStall not decoded yet
    stops: v.numPitstops,
    state: mapPitState(v.pitState),
  },
  gapToPlayerS: null,
  gapToPlayerM: null,
  closingRateMps: null,
});

const buildTire = (w: RawWheel, compound: string | null): Tire => ({
  tempC: {
    inner: kelvinToCelsius(w.tempK[0]),
    center: kelvinToCelsius(w.tempK[1]),
    outer: kelvinToCelsius(w.tempK[2]),
  },
  pressureKpa: w.pressureKpa,
  wear01: clamp01(w.wear),
  compound,
  surfaceTempC: null,
});

const DEFAULT_TIRE: Tire = {
  tempC: 0,
  pressureKpa: null,
  wear01: null,
  compound: null,
  surfaceTempC: null,
};

const buildPlayer = (
  scoring: RawVehicleScoring | null,
  tel: RawVehicleTelemetry | null,
  fuel: RollingFuel,
): PlayerCar => {
  const base: CarState = scoring
    ? baseCarState(scoring)
    : {
        id: -1,
        isPlayer: true,
        position: 1,
        classPosition: null,
        classId: null,
        className: null,
        driverName: null,
        lapDistanceM: 0,
        lapsCompleted: 0,
        lastLapS: null,
        bestLapS: null,
        worldPos: null,
        lateralPos: null,
        pit: { inPitLane: false, inPitStall: false, stops: 0, state: 'none' },
        gapToPlayerS: null,
        gapToPlayerM: null,
        closingRateMps: null,
      };

  const fuelLiters = tel ? tel.fuel : 0;
  const { perLapAvgLiters, lapsRemainingEst } = fuel.update(fuelLiters, base.lapsCompleted);
  const frontC = tel?.frontTireCompound || null;
  const rearC = tel?.rearTireCompound || null;

  const tires: WheelArray<Tire> = tel
    ? [
        buildTire(tel.wheels[0], frontC),
        buildTire(tel.wheels[1], frontC),
        buildTire(tel.wheels[2], rearC),
        buildTire(tel.wheels[3], rearC),
      ]
    : [DEFAULT_TIRE, DEFAULT_TIRE, DEFAULT_TIRE, DEFAULT_TIRE];

  const brakes: WheelArray<Brake> = tel
    ? [
        { discTempC: kelvinToCelsius(tel.wheels[0].brakeTempK) },
        { discTempC: kelvinToCelsius(tel.wheels[1].brakeTempK) },
        { discTempC: kelvinToCelsius(tel.wheels[2].brakeTempK) },
        { discTempC: kelvinToCelsius(tel.wheels[3].brakeTempK) },
      ]
    : [{ discTempC: null }, { discTempC: null }, { discTempC: null }, { discTempC: null }];

  return {
    ...base,
    isPlayer: true,
    fuel: {
      liters: Math.max(0, fuelLiters),
      capacityLiters: tel && tel.fuelCapacity > 0 ? tel.fuelCapacity : null,
      perLapAvgLiters,
      lapsRemainingEst,
    },
    tires,
    brakes,
    aids: {
      tc: null, // not in SHM (REST/setup, S2/S3)
      abs: null,
      // TODO(rig): mRearBrakeBias reads ~48–52%; confirm front-vs-rear vs the HUD (docs/03).
      brakeBias: { frontPct: tel ? tel.rearBrakeBias * 100 : null },
    },
    inputs: { throttle: 0, brake: 0, clutch: 0, steer: 0 }, // TODO: decode unfiltered inputs
    engine: {
      rpm: tel ? Math.max(0, tel.engineRPM) : 0,
      maxRpm: tel && tel.engineMaxRPM > 0 ? tel.engineMaxRPM : null,
      gear: tel ? tel.gear : 0,
      map: null, // engine-map index not in SHM
    },
    car: { name: 'Unknown', classId: base.classId, className: base.className }, // mVehicleName not decoded
    setupSummary: null,
  };
};

/**
 * Build a stateful LMU Normalizer. One instance per session (it accumulates rolling fuel and
 * per-car gap history for closing-rate). REST merge (T2.2) layers in later behind the same
 * `Normalizer<LmuRawFrame>` contract.
 */
export const createLmuNormalizer = (
  options: LmuNormalizerOptions = {},
): Normalizer<LmuRawFrame> => {
  const fuel = new RollingFuel(options.fuelWindowLaps ?? 5);
  const prevGap = new Map<number, { gapM: number; ms: number }>();

  return {
    toRaceState(frame: LmuRawFrame): RaceState {
      const { scoring, telemetry, tick, monotonicMs } = frame;
      const info = scoring.info;
      const trackLen = info.trackLengthM;

      const playerV = scoring.vehicles.find((v) => v.isPlayer) ?? null;
      const playerDist = playerV?.lapDistM ?? 0;
      const playerBehindLeader = playerV?.timeBehindLeader ?? 0;
      const telById = new Map<number, RawVehicleTelemetry>(
        (telemetry?.vehicles ?? []).map((v) => [v.id, v]),
      );

      const cars: CarState[] = [...scoring.vehicles]
        .sort((a, b) => a.place - b.place)
        .map((v) => {
          const car = baseCarState(v);
          if (playerV && v.id !== playerV.id) {
            car.gapToPlayerS = v.timeBehindLeader - playerBehindLeader;
            const gapM = alongTrackGap(playerDist, v.lapDistM, trackLen);
            car.gapToPlayerM = gapM;
            const prev = prevGap.get(v.id);
            const dt = prev ? (monotonicMs - prev.ms) / 1000 : 0;
            car.closingRateMps =
              prev && dt > 0 ? (Math.abs(prev.gapM) - Math.abs(gapM)) / dt : null;
            prevGap.set(v.id, { gapM, ms: monotonicMs });
          }
          return car;
        });

      const classes = new Set(
        scoring.vehicles.map((v) => v.vehicleClass).filter((c) => c.length > 0),
      );

      const session: SessionState = {
        game: 'lmu',
        phase: mapPhase(info.gamePhase),
        isTimed: info.endET > 0,
        elapsedS: Math.max(0, info.currentET),
        remainingS: info.endET > 0 ? Math.max(0, info.endET - info.currentET) : null,
        totalLaps: info.maxLaps > 0 ? info.maxLaps : null,
        serverName: null,
        multiClass: classes.size > 1,
      };

      return {
        tick,
        monotonicMs: Math.max(0, monotonicMs),
        session,
        player: buildPlayer(playerV, playerV ? (telById.get(playerV.id) ?? null) : null, fuel),
        cars,
        track: {
          name: info.trackName || null,
          lengthM: trackLen > 0 ? trackLen : null,
          sectorBoundariesM: null,
          surfaceTempC: info.trackTempC,
          gripEstimate: null,
        },
        weather: {
          airTempC: info.ambientTempC,
          trackTempC: info.trackTempC,
          rainIntensity01: null,
          wetness01: null,
          forecast: null,
        },
        flags: {
          global: mapGlobalFlag(info.gamePhase, info.yellowFlagState),
          sectorYellows: null, // mSectorFlag enum values (1/11 seen) not yet decoded — docs/03
          blueForPlayer: false,
        },
      };
    },
  };
};
