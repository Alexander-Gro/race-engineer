# 03 — Le Mans Ultimate Integration

This is the highest-risk, highest-detail document. LMU runs on the **rFactor 2
(gMotor)** engine, so its data-access story is inherited from rF2. Engine internals are
**version-sensitive** — every field and endpoint below must be confirmed against the
current LMU build via the research spikes (S1–S4) before code depends on it.

## Two data channels

LMU exposes data through two complementary channels:

1. **Shared memory (primary, high-frequency).** Via the **rF2 Shared Memory Map
   Plugin** by *The Iron Wolf* (`TheIronWolfModding/rF2SharedMemoryMapPlugin`). The
   plugin is a `.dll` dropped into the game's plugins folder. It mirrors the engine's
   internal telemetry/scoring structs into named **memory-mapped files** that any local
   process can read. This is the same interface CrewChief uses for LMU. **This is our
   main telemetry source.**

2. **Local REST API (secondary, lower-frequency).** LMU's own UI is web-based and talks
   to a local HTTP server (commonly observed around `http://localhost:6397/`). It serves
   session, standings, garage, and strategy data and is what tools like SimHub / LMU
   companion apps read. Useful for things not in shared memory (e.g. rich standings,
   strategy/garage state) and as a cross-check. **Read-only is assumed; confirm in S2.**

### Why both

Shared memory is fast and physics-rich but its struct contents depend on the plugin
version and what the engine fills in. The REST API is slower but exposes
session/garage/strategy concepts at a higher level. The adapter merges them into one
canonical `RaceState`.

## Channel 1 — Shared memory

### Setup (what the user must do)
1. Install the rF2 Shared Memory Map Plugin DLL into LMU's plugin directory
   (path TBD — confirm exact folder for LMU; for rF2 it is `Bin64/Plugins`). The app
   should detect its presence and **guide installation** if missing.
2. Ensure the plugin is enabled (rF2/LMU may need a `CustomPluginVariables` entry; some
   builds require enabling buffers explicitly).
3. Launch LMU and enter a session; the memory-mapped files appear.

> **S1 spike:** verify the plugin's current LMU compatibility, the exact install path,
> any enable flags, and which buffers/fields LMU actually populates (LMU may not fill
> every rF2 field). Do this before building the decoder.

### Memory-mapped files (names from the rF2 plugin — verify which exist for LMU)

| MMF name | Contents |
| --- | --- |
| `$rFactor2SMMP_Telemetry$` | Per-vehicle physics: wheels (temps/pressure/wear/brake temp), fuel, RPM, gear, speed, inputs, etc. |
| `$rFactor2SMMP_Scoring$` | Session + per-vehicle scoring: positions, lap dist, sector/lap times, gaps, pit state, flags |
| `$rFactor2SMMP_Rules$` | Rules/FCY/pit rules state |
| `$rFactor2SMMP_PitInfo$` | Pit menu / pit state info |
| `$rFactor2SMMP_Weather$` | Track/weather conditions |
| `$rFactor2SMMP_Extended$` | Plugin-added extras (e.g. physics options, session flags, tire compound names on some builds) |
| `$rFactor2SMMP_ForceFeedback$` | FFB value (not needed here) |
| `$rFactor2SMMP_Graphics$` | Graphics/HUD hints (not needed here) |
| `$rFactor2SMMP_HWControl$` | Write channel (inject control inputs) — **we do not use it; the app is read-only** |
| `$rFactor2SMMP_PluginControl$` | Enables optional features incl. the write buffers — not used by us |

### Reading correctly (torn-read protection)
The rF2 buffers are written by the game while we read them. Each buffer uses a
**version/update counter pattern** (a begin/end version pair, e.g. `mVersionUpdateBegin`
/ `mVersionUpdateEnd`): read the buffer, and if begin ≠ end, the write was in progress —
re-read. The adapter must implement this guard on every read. Also handle the buffer
simply not existing yet (game not running).

### Key telemetry fields we need (rF2 `rF2VehicleTelemetry` / `rF2Telemetry`)
- **Fuel:** `mFuel` (liters), `mFuelCapacity` (may live in extended/scoring), engine RPM
  `mEngineRPM`, max RPM, water/oil temps.
- **Wheels** `mWheels[4]` (FL, FR, RL, RR), each:
  - `mTemperature[3]` — inner / center / outer tread temps (Kelvin in rF2; convert).
  - `mPressure` — tire pressure (kPa).
  - `mWear` — tread wear (0..1, 1 = new on rF2 convention — verify direction).
  - `mBrakeTemp` — brake disc temp (Kelvin; convert).
  - `mGripFract`, `mRideHeight`, `mSuspensionDeflection`, surface/terrain flags.
- **Driver aids / controls:** current values for **traction control**, **ABS**, **brake
  bias / rear brake balance**, **engine map / mixture** — availability and field names
  **must be confirmed (S1)**. On some rF2 builds these are in the extended buffer or
  derivable; on others they are not exposed and must be tracked by the app (see §Writing).
- **Inputs:** `mUnfilteredThrottle/Brake/Steering/Clutch`, filtered versions.
- **Misc:** gear, speed (`mLocalVel`), position/orientation (`mPos`, `mOri`) for spotter.

### Key scoring fields (rF2 `rF2ScoringInfo` + `rF2VehicleScoring[]`)
- **Session:** session type (practice/qual/race), `mCurrentET` (elapsed time),
  `mEndET`, `mMaxLaps`, `mLapDist` (track length), sector boundaries, flags
  (`mGamePhase`, `mYellowFlagState`, sector yellow flags), `mNumVehicles`.
- **Per vehicle:** `mPlace`, `mIsPlayer`, driver/vehicle name, **class name**
  (`mVehicleClass` — critical for multi-class), `mTotalLaps`, `mLapDist` (distance
  around track — used for gaps/spotter), `mPathLateral`, `mTrackEdge`,
  `mTimeBehindNext` / `mLapsBehindNext`, `mTimeBehindLeader`, `mBestLapTime`,
  `mLastLapTime`, current sector times, `mPitState` / `mInPits` / `mNumPitstops`,
  `mFinishStatus`.

These give us position, gaps (time + distance), class, pit status, and the raw material
for spotter geometry and strategy.

### Tire compound / stint context
Compound names and tire set info appear inconsistently across rF2 builds (sometimes in
the extended buffer). For LMU specifically, the **REST API may be the better source** for
current compound and available sets. Decide in S1/S2.

## Channel 2 — Local REST API

> **S2 spike:** confirm base URL/port (observed ~`:6397`), enumerate endpoints, capture
> sample payloads, and confirm whether any endpoint accepts writes (e.g. setting a pit
> strategy). Tools in the community read this API; we will reverse-engineer it carefully
> and treat it as **unofficial and version-fragile**.

Expected useful data (to confirm): live standings with class and gaps, current car/track,
session info and timing, garage/setup state, **pit-strategy menu state** (fuel to add,
tire selection, repairs), and possibly weather/forecast.

Design rule: prefer shared memory for anything available there (latency); use REST for
higher-level session/standings/strategy data and to fill gaps. Cache REST responses and
poll at a modest rate (e.g. 1–5 Hz) to avoid hammering the game.

## We do not write to the game (read-only by design)

Race Engineer is **advisory and read-only**. It never injects input and never changes a
setting or driver aid. We deliberately do **not** use the plugin's `HWControl` write
channel or synthetic key presses. The engineer *tells* the driver what to change (e.g.
"move brake bias back two clicks"); the driver makes the change themselves. See
[08-INPUT-AND-CONTROLS.md](08-INPUT-AND-CONTROLS.md) and
[11-RISKS-AND-COMPLIANCE.md](11-RISKS-AND-COMPLIANCE.md).

Because of this, what matters from LMU is **reading the current values** so advice is
precise and so we can verify (from telemetry) that the driver applied a suggested change:

- **Current driver aids (TC / ABS / brake bias / engine map):** read from the
  shared-memory telemetry / extended buffer if exposed, otherwise from the setup file.
  **S3 spike:** confirm these values are *readable* and where. (We only read them.)

## Setups (read-only, to inform advice)

rF2/LMU car setups are stored as files in the player's vehicle setup folders. We open
them **read-only** to know the current setup so the engineer can recommend specific
changes. **We never write setup files**, so there is no risk of corrupting a user's
setups — the driver applies any change in the garage themselves.

> **S4 spike:** locate LMU's setup file directory and capture the file format (rF2 used a
> human-readable key/value `.svm`-style text format); confirm whether the REST API also
> exposes setup state as an alternative read source. Read-only; defensive parsing.

## The LMU Adapter (interface)

```ts
interface GameAdapter {
  id: 'lmu';
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Raw frame at the adapter's native cadence; Normalizer converts to RaceState. */
  onFrame(cb: (frame: RawFrame) => void): Unsubscribe;
  capabilities(): {
    hasSharedMemory: boolean;
    hasRestApi: boolean;
    readsCurrentAids: boolean;     // can we read current TC/ABS/brake-bias/engine-map?
    readsSetup: boolean;           // can we read the full setup (file/REST)?
    exposesTireCompound: boolean;
    fields: Set<CanonicalField>;   // which canonical fields are actually populated
  };
  // No write() method by design — the app is strictly read-only with respect to the game.
}
```

Internally the LMU adapter composes a `SharedMemoryReader` (koffi → Win32 MMF + struct
decoders generated from the plugin's headers) and a `RestClient` (polling + cache). It
reports `capabilities()` so the rest of the app degrades gracefully when LMU does not
populate a field.

## Validation harness

Build a **session recorder/replayer** early (`packages/adapters/sim-replay`): capture raw
frames to disk during a real LMU session, then replay them through the full pipeline
offline. This lets us develop strategy, events, and voice without launching the game
every time, and gives deterministic tests for the Strategy Engine.

## Open questions for the spikes (track here)

- [ ] **S1** Plugin install path + enable flags for current LMU build; populated fields.
- [ ] **S1** Are TC/ABS/brake-bias current values readable from telemetry? Where?
- [ ] **S2** REST base URL/port, endpoint list, payload schemas, read-only?
- [ ] **S2** Best source for tire compound + available tire sets (SHM vs REST).
- [ ] **S3** Are current TC/ABS/brake-bias/engine-map values *readable* (telemetry/extended buffer or setup file)? (Read-only — we never write them.)
- [ ] **S4** Setup file location + format for **read-only** parsing (and/or REST setup read).
- [ ] Multi-class specifics: class names/IDs for Hypercar / LMP2 / GTE-GT3 as reported.
- [ ] FCY / safety-car / pit-rules representation (for strategy opportunism).
- [ ] **S5** Plugin license + whether we may bundle/auto-install it into LMU's plugins folder, or must guide manual install. ([16-PLATFORM-PREREQUISITES.md](16-PLATFORM-PREREQUISITES.md))
- [ ] **S6** Reading the wheel via SDL2 while LMU holds the device (shared vs exclusive); device-GUID stability across reconnects. ([16-PLATFORM-PREREQUISITES.md](16-PLATFORM-PREREQUISITES.md))
- [ ] Coexistence with other readers (SimHub/CrewChief) on the same memory-mapped files.
