# 04 — Data Model

Defines the **canonical schema** that the whole app speaks. The Normalizer converts
raw, game-specific frames into these types; nothing downstream of the Normalizer should
reference rF2/LMU struct names. Units are normalized here once (SI-ish, human units for
display computed in the UI).

## Conventions

- Units: temperatures in **°C**, pressures in **kPa**, fuel in **liters**, distances in
  **meters**, speeds in **m/s** (UI converts to km/h / mph). Times in **seconds**
  (floats). Angles in radians.
- Wheel order is always **[FL, FR, RL, RR]**.
- All snapshots are **immutable**; the hot loop emits a new `RaceState` per tick.
- Every value that may be missing for a given game is `T | null`, and the adapter's
  `capabilities()` declares which fields it populates.

## RaceState (per tick)

```ts
type RaceState = {
  tick: number;                 // monotonic counter
  monotonicMs: number;          // app clock (not wall clock) for deltas
  session: SessionState;
  player: PlayerCar;
  cars: CarState[];             // all vehicles incl. player, by position
  track: TrackState;
  weather: WeatherState | null;
  flags: FlagState;
};
```

### SessionState
```ts
type SessionState = {
  game: 'lmu';
  phase: 'garage'|'practice'|'qualifying'|'formation'|'race'|'checkered'|'unknown';
  isTimed: boolean;             // timed vs lap-count race
  elapsedS: number;
  remainingS: number | null;    // for timed sessions
  totalLaps: number | null;     // for lap-count sessions
  serverName: string | null;
  multiClass: boolean;
};
```

### PlayerCar (extends CarState with private data)
```ts
type PlayerCar = CarState & {
  fuel: {
    liters: number;
    capacityLiters: number | null;
    perLapAvgLiters: number | null;   // rolling, Normalizer-computed
    lapsRemainingEst: number | null;  // liters / perLapAvg
  };
  tires: WheelArray<Tire>;
  brakes: WheelArray<Brake>;
  aids: DriverAids;
  inputs: { throttle: number; brake: number; clutch: number; steer: number };
  engine: { rpm: number; maxRpm: number | null; gear: number; map: number | null };
  car: { name: string; classId: string | null; className: string | null };
  setupSummary: SetupSummary | null;   // from setup file / REST when available
};

type WheelArray<T> = [T, T, T, T]; // FL, FR, RL, RR

type Tire = {
  tempC: { inner: number; center: number; outer: number } | number; // 3-zone or single
  pressureKpa: number | null;
  wear01: number | null;            // 0 = worn out .. 1 = new (normalize direction!)
  compound: string | null;
  surfaceTempC: number | null;
};

type Brake = { discTempC: number | null };

type DriverAids = {
  tc: AidLevel | null;              // traction control
  abs: AidLevel | null;
  brakeBias: { frontPct: number | null };  // front brake bias %
  // engine map handled under engine.map
};
type AidLevel = { value: number; min: number | null; max: number | null };
```

### CarState (every vehicle, incl. rivals)
```ts
type CarState = {
  id: number;                   // stable per session
  isPlayer: boolean;
  position: number;             // overall place
  classPosition: number | null; // place within class
  classId: string | null;
  className: string | null;     // "Hypercar" | "LMP2" | "GTE"/"GT3" ...
  driverName: string | null;
  lapDistanceM: number;         // distance around the lap (for gaps + spotter)
  lapsCompleted: number;
  lastLapS: number | null;
  bestLapS: number | null;
  worldPos: { x: number; y: number; z: number } | null; // spotter geometry
  lateralPos: number | null;    // signed offset from racing line; +right / -left of the
                                // driver (spotter convention — Normalizer T2.3 must honor
                                // this sign; confirm against live LMU data, else flip via
                                // spotterRule({ rightIsPositive: false }))
  pit: { inPitLane: boolean; inPitStall: boolean; stops: number; state: PitState };
  // Relative-to-player (computed by Normalizer):
  gapToPlayerS: number | null;  // + = behind player, - = ahead
  gapToPlayerM: number | null;
  closingRateMps: number | null;
};
type PitState = 'none'|'requested'|'entering'|'stopped'|'exiting';
```

### TrackState / WeatherState / FlagState
```ts
type TrackState = {
  name: string | null;
  lengthM: number | null;
  sectorBoundariesM: number[] | null;
  surfaceTempC: number | null;
  gripEstimate: number | null;  // if exposed
};
type WeatherState = {
  airTempC: number | null;
  trackTempC: number | null;
  rainIntensity01: number | null;
  wetness01: number | null;
  forecast: Array<{ inMinutes: number; rain01: number }> | null;
};
type FlagState = {
  global: 'green'|'yellow'|'fcy'|'safetyCar'|'red'|'checkered'|'none';
  sectorYellows: boolean[] | null;
  blueForPlayer: boolean;       // faster class approaching / being lapped
};
```

## Events (emitted by the Event Detector)

```ts
type EngineerEvent = {
  id: string;
  tick: number;
  type: EventType;
  tier: 0|1|2|3;                // latency/delivery tier (see 01-ARCHITECTURE)
  priority: number;             // for the voice queue; higher preempts
  payload: Record<string, unknown>;
  dedupeKey?: string;           // suppress repeats (e.g. same car alongside)
  cooldownMs?: number;
};

type EventType =
  // Tier 0 — reflex spotter (pre-rendered audio)
  | 'car_left' | 'car_right' | 'three_wide' | 'clear'
  // Tier 1 — templated
  | 'lap_completed' | 'fuel_low' | 'energy_low' | 'tire_temp_out_of_window'
  | 'pit_window_open' | 'box_this_lap' | 'blue_flag'
  | 'faster_class_approaching' | 'flag_changed'
  // Tier 2/3 — conversational / deliberative (LLM-phrased or driver-initiated)
  | 'strategy_update' | 'undercut_opportunity' | 'fcy_opportunity'
  | 'rival_pitted' | 'incident_ahead' | 'driver_question';
```

The Event Detector owns **debounce, cooldown, and dedupe** so the engineer is not
chatty. Example: `car_left` has a `dedupeKey` per adjacent car and a cooldown so it is
announced once per pass, not every tick.

> **Tier-0 pre-render set (voice layer, docs/07).** The voice package pre-renders a fixed
> phrase set for near-zero-latency reflex playback: the four reflex spotter `EventType`s
> (`car_left`/`car_right`/`three_wide`/`clear`) plus a couple of fixed call-out phrases that
> are *not* event types — `position_up`/`position_down`. These extra phrases are voice assets,
> not part of `EventType`; T5.4 wires events → cached clips.

## Derived / strategy types (see 05 for the math)

```ts
type FuelPlan = {
  perLapLiters: number;
  lapsRemainingOnFuel: number;
  lapsToFinish: number | null;
  litersToFinish: number | null;
  litersToAddNextStop: number | null;
  fuelSaveTargetLitersPerLap: number | null;  // to stretch a stint
  confidence01: number;                        // shrinks with low sample size
};

type StintPlan = {
  stints: Array<{
    index: number; startLap: number; endLap: number;
    fuelAddLiters: number; tireCompound: string | null;
    expectedDegradation01: number;
  }>;
  pitWindows: Array<{ earliestLap: number; latestLap: number; reason: string }>;
  mandatoryStopsRemaining: number | null;
};
```

## Persistence schema (SQLite)

Tables (indicative):

- `sessions(id, game, track, car, class, started_at, ended_at, type, server)`
- `laps(id, session_id, lap_no, lap_time_s, sector_times, fuel_used_l, fuel_left_l,
   avg_tire_temp, tire_wear, compound, conditions, valid)`
- `events(id, session_id, tick, type, tier, payload_json, spoken_text)`
- `transcripts(id, session_id, ts, role, text, audio_ref)` — role ∈ {driver, engineer}
- `fuel_models(car, track, conditions, per_lap_l_mean, per_lap_l_stdev, samples,
   updated_at)` — learned priors that seed `FuelPlan.confidence`
- `tire_models(car, track, compound, deg_curve_json, samples, updated_at)`
- `setups(id, car, track, name, file_path, params_json, notes, created_at)`

`fuel_models` and `tire_models` are the **learning layer**: after each session the app
updates per-car/track/condition priors so future estimates start accurate instead of
needing a full stint of samples. See [05-STRATEGY-ENGINE.md](05-STRATEGY-ENGINE.md).

## Why a canonical schema (not raw structs everywhere)

- **Multi-game readiness:** adding iRacing/ACC later means a new adapter, not a rewrite.
- **Testability:** strategy and events are tested against canonical fixtures, not live
  memory.
- **Stability:** plugin/engine version changes are absorbed in one place (the adapter +
  Normalizer), not scattered through the app.
