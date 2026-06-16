import { z } from 'zod';
import { unit01, wheelArray } from './primitives';

/**
 * The canonical telemetry schema (docs/04). The Normalizer converts raw, game-specific
 * frames into these types; nothing downstream of the Normalizer references rF2/LMU struct
 * names. Every value that may be missing for a given game is `T | null`.
 */

// --- Tires, brakes, aids -------------------------------------------------------------

/** Per-tire state. `tempC` is either a 3-zone reading or a single value when that's all the game exposes. */
export const TireSchema = z.object({
  tempC: z.union([
    z.object({ inner: z.number(), center: z.number(), outer: z.number() }),
    z.number(),
  ]),
  pressureKpa: z.number().nullable(),
  // 0 = worn out .. 1 = new. The Normalizer fixes the direction per game.
  wear01: unit01.nullable(),
  compound: z.string().nullable(),
  surfaceTempC: z.number().nullable(),
});
export type Tire = z.infer<typeof TireSchema>;

export const BrakeSchema = z.object({
  discTempC: z.number().nullable(),
});
export type Brake = z.infer<typeof BrakeSchema>;

/** A driver-aid setting with its valid range, when the game exposes it. */
export const AidLevelSchema = z.object({
  value: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
});
export type AidLevel = z.infer<typeof AidLevelSchema>;

export const DriverAidsSchema = z.object({
  tc: AidLevelSchema.nullable(), // traction control
  abs: AidLevelSchema.nullable(),
  brakeBias: z.object({ frontPct: z.number().min(0).max(100).nullable() }),
  // engine map is carried under PlayerCar.engine.map
});
export type DriverAids = z.infer<typeof DriverAidsSchema>;

/**
 * Read-only summary of the car's current setup, sourced from the setup file / REST when
 * available. docs/04 references this but does not pin its shape; the full parameter set is
 * specified in M9 (docs/08 §3). Kept intentionally permissive until then.
 */
export const SetupSummarySchema = z.object({
  name: z.string().nullable(),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
});
export type SetupSummary = z.infer<typeof SetupSummarySchema>;

// --- Cars ----------------------------------------------------------------------------

export const PitStateSchema = z.enum(['none', 'requested', 'entering', 'stopped', 'exiting']);
export type PitState = z.infer<typeof PitStateSchema>;

/** State of every vehicle on track (including the player), as the engineer sees it. */
export const CarStateSchema = z.object({
  id: z.number().int().nonnegative(), // stable per session
  isPlayer: z.boolean(),
  position: z.number().int().positive(), // overall place
  classPosition: z.number().int().positive().nullable(),
  classId: z.string().nullable(),
  className: z.string().nullable(), // "Hypercar" | "LMP2" | "GTE"/"GT3" ...
  driverName: z.string().nullable(),
  lapDistanceM: z.number().nonnegative(), // distance around the lap (gaps + spotter)
  lapsCompleted: z.number().int().nonnegative(),
  lastLapS: z.number().positive().nullable(),
  bestLapS: z.number().positive().nullable(),
  worldPos: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable(),
  lateralPos: z.number().nullable(), // signed offset from the racing line
  pit: z.object({
    inPitLane: z.boolean(),
    inPitStall: z.boolean(),
    stops: z.number().int().nonnegative(),
    state: PitStateSchema,
  }),
  // Relative-to-player, computed by the Normalizer:
  gapToPlayerS: z.number().nullable(), // + = behind player, - = ahead
  gapToPlayerM: z.number().nullable(),
  closingRateMps: z.number().nullable(),
});
export type CarState = z.infer<typeof CarStateSchema>;

/** The player's car: a {@link CarState} plus private telemetry only available for "us". */
export const PlayerCarSchema = CarStateSchema.extend({
  fuel: z.object({
    liters: z.number().nonnegative(),
    capacityLiters: z.number().positive().nullable(),
    perLapAvgLiters: z.number().nonnegative().nullable(), // rolling, Normalizer-computed
    lapsRemainingEst: z.number().nonnegative().nullable(), // liters / perLapAvg
  }),
  // Virtual Energy (LMU endurance): a normalized 0..1 per-stint energy budget consumed
  // alongside fuel. In LMU it is frequently the *binding* stint constraint — a car can have
  // fuel left but be out of VE (or vice versa) — so strategy must plan on min(fuel, VE).
  // null when the game/series doesn't expose it. Sourced from LMU REST /rest/strategy/usage,
  // NOT shared memory (docs/03 §VE); the REST→canonical mapping is the live half (S2.2).
  // `.default(null)` so recordings made before VE support (or from the SHM-only source, which
  // can't see VE) still validate — a missing key means "no VE data", parsed as null.
  virtualEnergy: z
    .object({
      level01: unit01, // VE remaining now, 0..1 of the per-stint budget
      perLapAvg01: unit01.nullable(), // rolling per-lap VE burn, Normalizer-computed
      lapsRemainingEst: z.number().nonnegative().nullable(), // level01 / perLapAvg01
    })
    .nullable()
    .default(null),
  tires: wheelArray(TireSchema),
  brakes: wheelArray(BrakeSchema),
  aids: DriverAidsSchema,
  inputs: z.object({
    throttle: z.number(),
    brake: z.number(),
    clutch: z.number(),
    steer: z.number(),
  }),
  engine: z.object({
    rpm: z.number().nonnegative(),
    maxRpm: z.number().positive().nullable(),
    gear: z.number().int(),
    map: z.number().nullable(),
  }),
  car: z.object({
    name: z.string(),
    classId: z.string().nullable(),
    className: z.string().nullable(),
  }),
  setupSummary: SetupSummarySchema.nullable(),
});
export type PlayerCar = z.infer<typeof PlayerCarSchema>;

// --- Session / track / weather / flags -----------------------------------------------

export const SessionStateSchema = z.object({
  game: z.literal('lmu'),
  phase: z.enum(['garage', 'practice', 'qualifying', 'formation', 'race', 'checkered', 'unknown']),
  isTimed: z.boolean(), // timed vs lap-count race
  elapsedS: z.number().nonnegative(),
  remainingS: z.number().nonnegative().nullable(), // for timed sessions
  totalLaps: z.number().int().positive().nullable(), // for lap-count sessions
  serverName: z.string().nullable(),
  multiClass: z.boolean(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const TrackStateSchema = z.object({
  name: z.string().nullable(),
  lengthM: z.number().positive().nullable(),
  sectorBoundariesM: z.array(z.number().nonnegative()).nullable(),
  surfaceTempC: z.number().nullable(),
  gripEstimate: z.number().nullable(),
});
export type TrackState = z.infer<typeof TrackStateSchema>;

export const WeatherStateSchema = z.object({
  airTempC: z.number().nullable(),
  trackTempC: z.number().nullable(),
  rainIntensity01: unit01.nullable(),
  wetness01: unit01.nullable(),
  forecast: z.array(z.object({ inMinutes: z.number(), rain01: unit01 })).nullable(),
});
export type WeatherState = z.infer<typeof WeatherStateSchema>;

export const FlagStateSchema = z.object({
  global: z.enum(['green', 'yellow', 'fcy', 'safetyCar', 'red', 'checkered', 'none']),
  sectorYellows: z.array(z.boolean()).nullable(),
  blueForPlayer: z.boolean(), // faster class approaching / being lapped
});
export type FlagState = z.infer<typeof FlagStateSchema>;

// --- The per-tick snapshot -----------------------------------------------------------

/** An immutable canonical snapshot emitted once per hot-loop tick. */
export const RaceStateSchema = z.object({
  tick: z.number().int().nonnegative(), // monotonic counter
  monotonicMs: z.number().nonnegative(), // app clock (not wall clock) for deltas
  session: SessionStateSchema,
  player: PlayerCarSchema,
  cars: z.array(CarStateSchema), // all vehicles incl. player, by position
  track: TrackStateSchema,
  weather: WeatherStateSchema.nullable(),
  flags: FlagStateSchema,
});
export type RaceState = z.infer<typeof RaceStateSchema>;
