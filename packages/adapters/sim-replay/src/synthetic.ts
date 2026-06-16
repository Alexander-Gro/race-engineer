import type { CarState, RaceState } from '@race-engineer/core';
import { makeCarState, makePlayerCar, makeTire, uniformWheel } from '@race-engineer/core/fixtures';

/**
 * Deterministic synthetic telemetry generator. Given a config it produces a plausible,
 * schema-valid sequence of canonical `RaceState` frames with **no randomness** — the same
 * config always yields byte-identical frames, which makes it the linchpin for offline
 * strategy/event/UI/voice development and reproducible tests (docs/03 §Validation harness).
 *
 * This is a data source, not strategy: the arithmetic here fabricates inputs, it does not
 * compute any advice (that lives in `@race-engineer/strategy`).
 */

export interface SyntheticRival {
  id: number;
  classId: string;
  className: string;
  driverName: string;
  /** This rival's lap pace in seconds. */
  lapTimeS: number;
  /** Signed along-track distance offset at t=0 (negative = starts behind the line). */
  startOffsetM: number;
}

export interface SyntheticConfig {
  trackName: string;
  lapDistanceM: number;
  /** The player's lap pace in seconds. */
  baseLapTimeS: number;
  /** Frames emitted per second of sim time. */
  hz: number;
  /** Total number of frames to emit. */
  ticks: number;
  startFuelLiters: number;
  fuelCapacityLiters: number;
  fuelPerLapLiters: number;
  /** Virtual Energy at t=0 (0..1 of the per-stint budget); omit to leave VE unmodelled (null). */
  startEnergy01?: number;
  /** Virtual-Energy burn per lap (0..1); omit to leave VE unmodelled (null). */
  energyPerLap01?: number;
  /** Tire wear fraction lost per lap (0..1 of the full range). */
  tireWearPerLap01: number;
  playerId: number;
  playerClassId: string;
  playerClassName: string;
  playerCarName: string;
  rivals: SyntheticRival[];
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

interface LapMetrics {
  lapsCompleted: number;
  lapDistanceM: number;
}

const lapMetrics = (rawDist: number, lapDistanceM: number): LapMetrics => {
  const lapsCompleted = Math.max(0, Math.floor(rawDist / lapDistanceM));
  const along = ((rawDist % lapDistanceM) + lapDistanceM) % lapDistanceM;
  return { lapsCompleted, lapDistanceM: along };
};

interface CarKin {
  id: number;
  classId: string;
  className: string;
  driverName: string;
  isPlayer: boolean;
  speedMps: number;
  lapTimeS: number;
  rawDist: number;
}

/** A small lateral offset so cars sit off the centreline (deterministic, by car id). */
const lateralFor = (id: number): number => (id % 2 === 0 ? 0.9 : -0.9);

/** Generate the full frame sequence for a config. Pure and deterministic. */
export const synthesizeFrames = (config: SyntheticConfig): RaceState[] => {
  const {
    lapDistanceM,
    baseLapTimeS,
    hz,
    ticks,
    startFuelLiters,
    fuelCapacityLiters,
    fuelPerLapLiters,
    startEnergy01,
    energyPerLap01,
    tireWearPerLap01,
    rivals,
  } = config;

  const playerSpeed = lapDistanceM / baseLapTimeS;
  const totalDurationS = ticks / hz;
  const classes = new Set([config.playerClassId, ...rivals.map((r) => r.classId)]);
  const multiClass = classes.size > 1;

  const frames: RaceState[] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    const elapsedS = tick / hz;

    const playerKin: CarKin = {
      id: config.playerId,
      classId: config.playerClassId,
      className: config.playerClassName,
      driverName: 'You',
      isPlayer: true,
      speedMps: playerSpeed,
      lapTimeS: baseLapTimeS,
      rawDist: playerSpeed * elapsedS,
    };

    const rivalKins: CarKin[] = rivals.map((r) => {
      const speedMps = lapDistanceM / r.lapTimeS;
      return {
        id: r.id,
        classId: r.classId,
        className: r.className,
        driverName: r.driverName,
        isPlayer: false,
        speedMps,
        lapTimeS: r.lapTimeS,
        rawDist: r.startOffsetM + speedMps * elapsedS,
      };
    });

    const all = [playerKin, ...rivalKins];

    // Rank by distance; ties broken by id so positions are always unique.
    const ahead = (a: CarKin, b: CarKin): boolean =>
      b.rawDist > a.rawDist || (b.rawDist === a.rawDist && b.id < a.id);
    const overallPos = (k: CarKin): number => all.filter((o) => ahead(k, o)).length + 1;
    const classPos = (k: CarKin): number =>
      all.filter((o) => o.classId === k.classId && ahead(k, o)).length + 1;

    const buildRival = (k: CarKin): CarState => {
      const m = lapMetrics(k.rawDist, lapDistanceM);
      const gapM = playerKin.rawDist - k.rawDist; // + = behind player
      const lateral = lateralFor(k.id);
      return makeCarState({
        id: k.id,
        position: overallPos(k),
        classPosition: classPos(k),
        classId: k.classId,
        className: k.className,
        driverName: k.driverName,
        lapDistanceM: m.lapDistanceM,
        lapsCompleted: m.lapsCompleted,
        lastLapS: m.lapsCompleted >= 1 ? k.lapTimeS : null,
        bestLapS: m.lapsCompleted >= 1 ? k.lapTimeS : null,
        worldPos: { x: lateral, y: 0, z: m.lapDistanceM },
        lateralPos: lateral,
        gapToPlayerS: gapM / playerSpeed,
        gapToPlayerM: gapM,
        closingRateMps: k.speedMps - playerSpeed, // + = closing on the player
      });
    };

    const pm = lapMetrics(playerKin.rawDist, lapDistanceM);
    const lapsFloat = playerKin.rawDist / lapDistanceM;
    const fuelLiters = Math.max(0, startFuelLiters - fuelPerLapLiters * lapsFloat);
    const perLapAvg = pm.lapsCompleted >= 1 ? fuelPerLapLiters : null;
    const lapsRemainingEst = perLapAvg !== null && perLapAvg > 0 ? fuelLiters / perLapAvg : null;

    // Virtual Energy arc, mirroring fuel — a 0..1 budget draining at a steady per-lap rate.
    const virtualEnergy =
      startEnergy01 !== undefined && energyPerLap01 !== undefined
        ? {
            level01: clamp01(startEnergy01 - energyPerLap01 * lapsFloat),
            perLapAvg01: pm.lapsCompleted >= 1 ? energyPerLap01 : null,
            lapsRemainingEst:
              pm.lapsCompleted >= 1 && energyPerLap01 > 0
                ? clamp01(startEnergy01 - energyPerLap01 * lapsFloat) / energyPerLap01
                : null,
          }
        : null;

    const lastLapS = pm.lapsCompleted >= 1 ? baseLapTimeS : null;
    const wear = clamp01(1 - tireWearPerLap01 * lapsFloat);

    // Public CarState view of the player; private telemetry lives only on `player` below,
    // never duplicated into the public `cars` array.
    const playerCarFields = {
      id: config.playerId,
      position: overallPos(playerKin),
      classPosition: classPos(playerKin),
      classId: config.playerClassId,
      className: config.playerClassName,
      driverName: 'You',
      lapDistanceM: pm.lapDistanceM,
      lapsCompleted: pm.lapsCompleted,
      lastLapS,
      bestLapS: lastLapS,
      worldPos: { x: 0, y: 0, z: pm.lapDistanceM },
      lateralPos: 0,
      gapToPlayerS: null,
      gapToPlayerM: null,
      closingRateMps: null,
    };

    const player = makePlayerCar({
      ...playerCarFields,
      fuel: {
        liters: fuelLiters,
        capacityLiters: fuelCapacityLiters,
        perLapAvgLiters: perLapAvg,
        lapsRemainingEst,
      },
      virtualEnergy,
      tires: uniformWheel(
        makeTire({
          tempC: 90,
          pressureKpa: 175,
          wear01: wear,
          compound: 'medium',
          surfaceTempC: 88,
        }),
      ),
      aids: {
        tc: { value: 4, min: 0, max: 11 },
        abs: { value: 3, min: 0, max: 11 },
        brakeBias: { frontPct: 54 },
      },
      engine: { rpm: 7800, maxRpm: 9000, gear: 5, map: 5 },
      car: {
        name: config.playerCarName,
        classId: config.playerClassId,
        className: config.playerClassName,
      },
      setupSummary: null,
    });

    const cars: CarState[] = [makeCarState(playerCarFields), ...rivalKins.map(buildRival)].sort(
      (a, b) => a.position - b.position,
    );

    const frame: RaceState = {
      tick,
      monotonicMs: (tick * 1000) / hz,
      session: {
        game: 'lmu',
        phase: 'race',
        isTimed: true,
        elapsedS,
        remainingS: Math.max(0, totalDurationS - elapsedS),
        totalLaps: null,
        serverName: 'Synthetic',
        multiClass,
      },
      player,
      cars,
      track: {
        name: config.trackName,
        lengthM: lapDistanceM,
        sectorBoundariesM: [Math.round(lapDistanceM / 3), Math.round((2 * lapDistanceM) / 3)],
        surfaceTempC: 30,
        gripEstimate: null,
      },
      weather: {
        airTempC: 22,
        trackTempC: 30,
        rainIntensity01: 0,
        wetness01: 0,
        forecast: null,
      },
      flags: { global: 'green', sectorYellows: null, blueForPlayer: false },
    };

    frames.push(frame);
  }

  return frames;
};

/** A modest default scenario: a steady multi-class cruise with no scripted incidents. */
export const defaultSyntheticConfig = (): SyntheticConfig => ({
  trackName: 'Synthetic Circuit',
  lapDistanceM: 5000,
  baseLapTimeS: 100,
  hz: 1,
  ticks: 300,
  startFuelLiters: 60,
  fuelCapacityLiters: 80,
  fuelPerLapLiters: 3, // 60 / 3 = 20 laps on fuel
  startEnergy01: 1.0,
  energyPerLap01: 0.052, // 1.0 / 0.052 ≈ 19.2 laps on VE → VE is the (slight) binding constraint
  tireWearPerLap01: 0.04,
  playerId: 7,
  playerClassId: 'hypercar',
  playerClassName: 'Hypercar',
  playerCarName: 'Synthetic LMH',
  rivals: [
    {
      id: 2,
      classId: 'hypercar',
      className: 'Hypercar',
      driverName: 'Rival A',
      lapTimeS: 101,
      startOffsetM: 400,
    },
    {
      id: 5,
      classId: 'lmp2',
      className: 'LMP2',
      driverName: 'Rival B',
      lapTimeS: 106,
      startOffsetM: -300,
    },
    {
      id: 9,
      classId: 'gte',
      className: 'GTE',
      driverName: 'Rival C',
      lapTimeS: 112,
      startOffsetM: 1500,
    },
  ],
});

/**
 * A scripted scenario for tests/demos: a faster class-rival starts behind and overtakes the
 * player around lap 3, and the stint runs the tank down to a fuel-low state by the end.
 */
export const scriptedScenario = (): SyntheticConfig => {
  const lapDistanceM = 4000;
  const baseLapTimeS = 60;
  const overtakeAtLap = 3;
  const duelLapTimeS = 58; // faster than the player
  const playerSpeed = lapDistanceM / baseLapTimeS;
  const duelSpeed = lapDistanceM / duelLapTimeS;
  // Place the duellist behind the line so the gap reaches zero at `overtakeAtLap`.
  const duelStartOffsetM = overtakeAtLap * baseLapTimeS * (playerSpeed - duelSpeed);

  return {
    trackName: 'Synthetic Short Circuit',
    lapDistanceM,
    baseLapTimeS,
    hz: 1,
    ticks: 600, // 10 laps
    startFuelLiters: 30,
    fuelCapacityLiters: 30,
    fuelPerLapLiters: 3, // empties the tank by ~lap 10
    startEnergy01: 1.0,
    energyPerLap01: 0.11, // ≈ 9.1 laps on VE → energy runs out ~a lap before fuel
    tireWearPerLap01: 0.06,
    playerId: 7,
    playerClassId: 'hypercar',
    playerClassName: 'Hypercar',
    playerCarName: 'Synthetic LMH',
    rivals: [
      {
        id: 2,
        classId: 'hypercar',
        className: 'Hypercar',
        driverName: 'Duellist',
        lapTimeS: duelLapTimeS,
        startOffsetM: duelStartOffsetM,
      },
      {
        id: 5,
        classId: 'lmp2',
        className: 'LMP2',
        driverName: 'P2 Runner',
        lapTimeS: 64,
        startOffsetM: 500,
      },
      {
        id: 9,
        classId: 'gte',
        className: 'GTE',
        driverName: 'GT Runner',
        lapTimeS: 70,
        startOffsetM: -200,
      },
    ],
  };
};
