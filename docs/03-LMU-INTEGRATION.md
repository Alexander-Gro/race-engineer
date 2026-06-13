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

## S1 desk-research findings (verify live)

> **Status:** transcribed from public source as of 2026-06-13. The struct layouts, MMF
> names, version-counter mechanism, packing, and install/enable steps below are
> **confirmed from source**. What is **NOT** confirmable by desk research — and is flagged
> `LIVE-VERIFY` throughout — is *which fields the current LMU build actually populates*
> (LMU is a separate product on the rF2 engine; it may zero/omit fields rF2 fills, and the
> reverse). The user must run the live dump (steps at the end) on the rig to confirm.
>
> **Sources (public):**
> - C++ struct source of truth: `TheIronWolfModding/rF2SharedMemoryMapPlugin`,
>   `Include/rF2State.h` —
>   <https://github.com/TheIronWolfModding/rF2SharedMemoryMapPlugin/blob/master/Include/rF2State.h>
> - MMF name constants: same repo,
>   `Monitor/rF2SMMonitor/rF2SMMonitor/rF2Data.cs` —
>   <https://github.com/TheIronWolfModding/rF2SharedMemoryMapPlugin/blob/master/Monitor/rF2SMMonitor/rF2SMMonitor/rF2Data.cs>
> - Plugin source / install: same repo, `Source/rFactor2SharedMemoryMap.cpp` + README —
>   <https://github.com/TheIronWolfModding/rF2SharedMemoryMapPlugin>
> - Python ctypes mirror (1:1 to header, useful pattern for koffi): `TonyWhitley/pyRfactor2SharedMemory`,
>   `rF2data.py` — <https://github.com/TonyWhitley/pyRfactor2SharedMemory/blob/master/rF2data.py>
> - CrewChief rF2 setup (install path + enable): <https://mr_belowski.gitlab.io/CrewChiefV4/GettingStarted_GameSpecific_rFactor2.html>
> - LMU-specific install confirmation (Apr 2025 community thread): <https://community.lemansultimate.com/index.php?threads/unable-to-install-rf2-shared-memory-map-plugin.7021/>

### 1. Memory-mapped file names (confirmed from source)

Opened with `OpenFileMapping` (the app is the **reader**, so we open existing maps, never
create). Names verbatim from `rF2Data.cs`:

| Constant | String value | Notes |
| --- | --- | --- |
| `MM_TELEMETRY_FILE_NAME` | `$rFactor2SMMP_Telemetry$` | per-vehicle physics |
| `MM_SCORING_FILE_NAME` | `$rFactor2SMMP_Scoring$` | session + per-vehicle scoring |
| `MM_RULES_FILE_NAME` | `$rFactor2SMMP_Rules$` | rules/FCY/pit rules |
| `MM_FORCE_FEEDBACK_FILE_NAME` | `$rFactor2SMMP_ForceFeedback$` | not needed |
| `MM_GRAPHICS_FILE_NAME` | `$rFactor2SMMP_Graphics$` | not needed |
| `MM_PITINFO_FILE_NAME` | `$rFactor2SMMP_PitInfo$` | pit menu/state |
| `MM_WEATHER_FILE_NAME` | `$rFactor2SMMP_Weather$` | weather |
| `MM_EXTENDED_FILE_NAME` | `$rFactor2SMMP_Extended$` | plugin extras incl. aid flags |
| `MM_HWCONTROL_FILE_NAME` | `$rFactor2SMMP_HWControl$` | **WRITE channel — we never open** |
| `MM_WEATHER_CONTROL_FILE_NAME` | `$rFactor2SMMP_WeatherControl$` | **WRITE channel — we never open** |
| `MM_RULES_CONTROL_FILE_NAME` | `$rFactor2SMMP_RulesControl$` | **WRITE channel — we never open** |
| `MM_PLUGIN_CONTROL_FILE_NAME` | `$rFactor2SMMP_PluginControl$` | **WRITE channel (enables the others) — we never open** |

Namespace note: in single-player these names are **session-local** (no `Global\` prefix).
For dedicated servers the plugin's `DedicatedServerMapGlobally` variable maps them under
`Global\` — irrelevant for our local single-process reader. The names are plain ANSI;
`OpenFileMapping` via koffi can use the ANSI (`OpenFileMappingA`) variant with these
literals, or the wide (`W`) variant with widened strings. **LIVE-VERIFY:** that LMU
creates these exact names (it uses the same plugin DLL, so it should — confirm with the
dump). The four `*Control` write buffers are out of scope by design (read-only product).

### 2. Torn-read / version-counter mechanism (confirmed from source)

Each mapped buffer begins with a version block. From `rF2State.h`:

```cpp
struct rF2MappedBufferVersionBlock {
  unsigned long mVersionUpdateBegin;   // incremented right before the buffer is written
  unsigned long mVersionUpdateEnd;     // incremented after the write is done
};
```

`unsigned long` is **32-bit** on the Win64 LLP64 ABI (so: `uint32`). The wrapper structs
inherit this pair as their first two fields (see below). Read protocol (implement on every
read):

1. Read `mVersionUpdateBegin`.
2. `memcpy` the whole buffer into a local copy.
3. Read `mVersionUpdateEnd` (from the live map, not the copy).
4. If `begin != end`, or if either changed vs. a re-read, a write was in flight → discard
   and retry (bounded retries, then skip the frame). Only accept frames where
   `begin == end` and the value is stable across the copy.

`pyRfactor2SharedMemory` declares these as `ctypes.c_int` (it treats the 32 bits as signed,
which is harmless for an equality compare). For koffi use `uint32` to match the C++ type
exactly.

### 3. Struct field layouts (confirmed from source — transcribe verbatim into koffi)

All from `rF2State.h`. **The whole file is wrapped in `#pragma pack(push, 4)` …
`#pragma pack(pop)` — see §4.** Field order below is byte-offset-significant; keep it
exact. C++ `long`/`unsigned long` = 32-bit on Win64; `bool` = 1 byte; `char[N]` = fixed
ANSI byte array. `ULONGLONG` = 8-byte unsigned. `rF2Vec3` = three `double` (x,y,z).

```cpp
struct rF2Vec3 { double x, y, z; };
```

#### rF2Wheel (one per corner; array order [FL, FR, RL, RR])
```cpp
struct rF2Wheel {
  double mSuspensionDeflection;
  double mRideHeight;
  double mSuspForce;
  double mBrakeTemp;                 // Kelvin
  double mBrakePressure;
  double mRotation;
  double mLateralPatchVel;
  double mLongitudinalPatchVel;
  double mLateralGroundVel;
  double mLongitudinalGroundVel;
  double mCamber;
  double mLateralForce;
  double mLongitudinalForce;
  double mTireLoad;
  double mGripFract;
  double mPressure;                  // kPa
  double mTemperature[3];            // Kelvin: [inner, center, outer]
  double mWear;                      // 0..1
  char   mTerrainName[16];
  unsigned char mSurfaceType;
  bool   mFlat;
  bool   mDetached;
  unsigned char mStaticUndeflectedRadius;
  double mVerticalTireDeflection;
  double mWheelYLocation;
  double mToe;
  double mTireCarcassTemperature;    // Kelvin
  double mTireInnerLayerTemperature[3]; // Kelvin
  unsigned char mExpansion[24];
};
```

#### rF2VehicleTelemetry (one per car; first in the telemetry array is usually the player)
```cpp
struct rF2VehicleTelemetry {
  long   mID;
  double mDeltaTime;
  double mElapsedTime;
  long   mLapNumber;
  double mLapStartET;
  char   mVehicleName[64];
  char   mTrackName[64];
  rF2Vec3 mPos;
  rF2Vec3 mLocalVel;                 // m/s (speed = magnitude)
  rF2Vec3 mLocalAccel;
  rF2Vec3 mOri[3];                   // orientation matrix rows
  rF2Vec3 mLocalRot;
  rF2Vec3 mLocalRotAccel;
  long   mGear;                      // -1 reverse, 0 neutral, 1.. forward
  double mEngineRPM;
  double mEngineWaterTemp;           // Celsius (engine temps are °C, not Kelvin)
  double mEngineOilTemp;             // Celsius
  double mClutchRPM;
  double mUnfilteredThrottle;        // 0..1
  double mUnfilteredBrake;           // 0..1
  double mUnfilteredSteering;        // -1..1
  double mUnfilteredClutch;          // 0..1
  double mFilteredThrottle;
  double mFilteredBrake;
  double mFilteredSteering;
  double mFilteredClutch;
  double mSteeringShaftTorque;
  double mFront3rdDeflection;
  double mRear3rdDeflection;
  double mFrontWingHeight;
  double mFrontRideHeight;
  double mRearRideHeight;
  double mDrag;
  double mFrontDownforce;
  double mRearDownforce;
  double mFuel;                      // liters
  double mEngineMaxRPM;
  unsigned char mScheduledStops;
  bool   mOverheating;
  bool   mDetached;
  bool   mHeadlights;
  unsigned char mDentSeverity[8];
  double mLastImpactET;
  double mLastImpactMagnitude;
  rF2Vec3 mLastImpactPos;
  double mEngineTorque;
  long   mCurrentSector;
  unsigned char mSpeedLimiter;
  unsigned char mMaxGears;
  unsigned char mFrontTireCompoundIndex;
  unsigned char mRearTireCompoundIndex;
  double mFuelCapacity;              // liters
  unsigned char mFrontFlapActivated;
  unsigned char mRearFlapActivated;
  unsigned char mRearFlapLegalStatus;
  unsigned char mIgnitionStarter;
  char   mFrontTireCompoundName[18];
  char   mRearTireCompoundName[18];
  unsigned char mSpeedLimiterAvailable;
  unsigned char mAntiStallActivated;
  unsigned char mUnused[2];
  float  mVisualSteeringWheelRange;
  double mRearBrakeBias;             // brake bias as fraction (current value — S3!)
  double mTurboBoostPressure;
  float  mPhysicsToGraphicsOffset[3];
  float  mPhysicalSteeringWheelRange;
  double mBatteryChargeFraction;     // hybrid (relevant to LMU Hypercar)
  double mElectricBoostMotorTorque;
  double mElectricBoostMotorRPM;
  double mElectricBoostMotorTemperature;
  double mElectricBoostWaterTemperature;
  unsigned char mElectricBoostMotorState;
  unsigned char mExpansion[111];
  rF2Wheel mWheels[4];               // [FL, FR, RL, RR]
};
```

> **Aids note (S3):** `mRearBrakeBias` gives current brake bias from telemetry. There is
> **no** `mTractionControl`/`mABS`/`mEngineMap` *level* field in this struct — those cockpit
> aid indices are not in per-vehicle telemetry. `rF2Extended.mPhysics` has only sim
> driving-aid difficulty flags (see §rF2Extended), not the in-car map index. So current
> TC/ABS/engine-map levels probably come from REST (S2) or the setup file (S4). LIVE-VERIFY.

#### rF2Telemetry (the wrapper / what the Telemetry MMF contains)
```cpp
struct rF2MappedBufferHeader { static int const MAX_MAPPED_VEHICLES = 128; };
struct rF2MappedBufferHeaderWithSize : public rF2MappedBufferHeader { int mBytesUpdatedHint; };

struct rF2Telemetry : public rF2MappedBufferHeaderWithSize {
  long mNumVehicles;
  rF2VehicleTelemetry mVehicles[128];   // MAX_MAPPED_VEHICLES
};
```

**koffi-relevant subtlety on the version block:** the C++ classes use inheritance —
`rF2MappedBufferHeader` is the base. In the actual mapped layout the version block
(`mVersionUpdateBegin`/`mVersionUpdateEnd`) is laid out **first**, before
`mBytesUpdatedHint` and `mNumVehicles`. The C# monitor and the Python ctypes mirror both
flatten this so the buffer struct is, in declaration order:
`uint32 mVersionUpdateBegin; uint32 mVersionUpdateEnd; int32 mBytesUpdatedHint;
int32 mNumVehicles; rF2VehicleTelemetry mVehicles[128];`. **Build the koffi struct
flattened in exactly that order** (do not model C++ inheritance in koffi). Array size of
the vehicles array = **128** (`MAX_MAPPED_VEHICLES`).

#### rF2ScoringInfo (session-level)
```cpp
struct rF2ScoringInfo {
  char   mTrackName[64];
  long   mSession;                   // session type/index
  double mCurrentET;                 // elapsed time
  double mEndET;                     // scheduled end time (race time limit)
  long   mMaxLaps;
  double mLapDist;                   // track length (m)
  unsigned char pointer1[8];         // 8 on x64, 4 on x86 (we are x64)
  long   mNumVehicles;
  unsigned char mGamePhase;
  signed char mYellowFlagState;
  signed char mSectorFlag[3];
  unsigned char mStartLight;
  unsigned char mNumRedLights;
  bool   mInRealtime;
  char   mPlayerName[32];
  char   mPlrFileName[64];
  double mDarkCloud;
  double mRaining;
  double mAmbientTemp;               // Celsius
  double mTrackTemp;                 // Celsius
  rF2Vec3 mWind;
  double mMinPathWetness;
  double mMaxPathWetness;
  unsigned char mGameMode;
  bool   mIsPasswordProtected;
  unsigned short mServerPort;
  unsigned long mServerPublicIP;
  long   mMaxPlayers;
  char   mServerName[32];
  float  mStartET;
  double mAvgPathWetness;
  unsigned char mExpansion[200];
  unsigned char pointer2[8];         // 8 on x64
};
```

> **x64 pointer-padding note:** `pointer1`/`pointer2` are `unsigned char[8]` on x64
> (`_AMD64_`). They stand in for engine pointers and are byte-offset-critical. Use 8-byte
> arrays in koffi (LMU is x64-only, matching our Windows-only target).

#### rF2VehicleScoring (per car)
```cpp
struct rF2VehicleScoring {
  long   mID;
  char   mDriverName[32];
  char   mVehicleName[64];
  short  mTotalLaps;
  signed char mSector;
  signed char mFinishStatus;
  double mLapDist;                   // distance around track (m) — gaps/spotter
  double mPathLateral;
  double mTrackEdge;
  double mBestSector1;
  double mBestSector2;
  double mBestLapTime;
  double mLastSector1;
  double mLastSector2;
  double mLastLapTime;
  double mCurSector1;
  double mCurSector2;
  short  mNumPitstops;
  short  mNumPenalties;
  bool   mIsPlayer;
  signed char mControl;              // who controls car (player/AI/remote/etc.)
  bool   mInPits;
  unsigned char mPlace;             // finishing/running position (1-based)
  char   mVehicleClass[32];          // CLASS NAME — multi-class key
  double mTimeBehindNext;
  long   mLapsBehindNext;
  double mTimeBehindLeader;
  long   mLapsBehindLeader;
  double mLapStartET;
  rF2Vec3 mPos;
  rF2Vec3 mLocalVel;
  rF2Vec3 mLocalAccel;
  rF2Vec3 mOri[3];
  rF2Vec3 mLocalRot;
  rF2Vec3 mLocalRotAccel;
  unsigned char mHeadlights;
  unsigned char mPitState;           // pit state enum (none/req/entering/stopped/exiting)
  unsigned char mServerScored;
  unsigned char mIndividualPhase;
  long   mQualification;
  double mTimeIntoLap;
  double mEstimatedLapTime;
  char   mPitGroup[24];
  unsigned char mFlag;
  bool   mUnderYellow;
  unsigned char mCountLapFlag;
  bool   mInGarageStall;
  unsigned char mUpgradePack[16];
  float  mPitLapDist;
  float  mBestLapSector1;
  float  mBestLapSector2;
  unsigned char mExpansion[48];
};
```

#### rF2Scoring (the wrapper / what the Scoring MMF contains)
```cpp
struct rF2Scoring : public rF2MappedBufferHeaderWithSize {
  rF2ScoringInfo mScoringInfo;
  rF2VehicleScoring mVehicles[128];   // MAX_MAPPED_VEHICLES
};
```

Flattened for koffi (same inheritance flattening as Telemetry):
`uint32 mVersionUpdateBegin; uint32 mVersionUpdateEnd; int32 mBytesUpdatedHint;
rF2ScoringInfo mScoringInfo; rF2VehicleScoring mVehicles[128];`. (Note: there is **no**
separate `mNumVehicles` on the `rF2Scoring` wrapper — vehicle count lives inside
`mScoringInfo.mNumVehicles`.) Array size = **128**.

#### rF2Extended (plugin-added extras — relevant to S3)
The extended buffer inherits only the version block (no `mBytesUpdatedHint`). High-level
content (full list in the header; key parts for us):
- `char mVersion[12]` — plugin version string; `bool is64bit`.
- `rF2PhysicsOptions mPhysics` — **driving-aid difficulty flags**, all `unsigned char`:
  `mTractionControl`, `mAntiLockBrakes`, `mStabilityControl`, `mAutoShift`, `mAutoClutch`,
  `mAutoBlip`, `mAutoLift`, `mFuelMult`, `mTireMult`, etc. **These are the *sim setting*
  levels, not the in-car wheel-toggled TC/ABS map index.** Useful to know assists are
  enabled, not sufficient for "current TC = 4" advice. LIVE-VERIFY whether LMU populates
  these and whether the values mean anything we can advise from.
- Damage tracking (`rF2TrackedDamage mTrackedDamages[512]`), session-start ticks,
  `rF2SessionTransitionCapture`, status/LSI message strings (pit-state, order, rules
  instruction text — useful for FCY/pit context), `float mCurrentPitSpeedLimit`.
- Write-enable flags (read-only telltales): `mHWControlInputEnabled`,
  `mWeatherControlInputEnabled`, `mRulesControlInputEnabled`, `mPluginControlInputEnabled`,
  and `mDirectMemoryAccessEnabled`, `mUnsubscribedBuffersMask`. **We never use the control
  write buffers** — these flags only tell us whether *someone* enabled them.

> **No tire-compound names in Extended.** Compound *index* + *name* live in
> `rF2VehicleTelemetry` (`mFront/RearTireCompoundIndex`, `mFront/RearTireCompoundName[18]`),
> not Extended. Whether LMU fills the name strings is unknown → LIVE-VERIFY; else use REST (S2).

### 4. Packing / alignment (confirmed from source)

`rF2State.h` wraps **all** structs in `#pragma pack(push, 4)` / `#pragma pack(pop)`, so the
structs are **4-byte packed** (not the natural 8-byte alignment the doubles would imply).
`pyRfactor2SharedMemory` mirrors this with `_pack_ = 4` on every `ctypes.Structure`.
**For koffi:** declare every struct with `koffi.pack(1, …)` is *wrong*; use koffi's pack of
**4** (e.g. `koffi.struct('rF2Wheel', { … })` then ensure 4-byte packing — in koffi this is
done by wrapping fields so the struct uses `#pragma pack(4)` semantics; if koffi's struct
API doesn't expose pack-4 directly, fall back to a hand-laid byte layout, but pack=4 is the
contract). Getting this wrong shifts every offset after the first sub-8-byte field
(e.g. the `unsigned char` runs in `rF2Wheel`/`rF2VehicleTelemetry`). **This is the single
most likely source of garbage reads — verify the first dump's known fields
(`mTrackName`, `mFuel`, `mEngineRPM`) read sanely before trusting deep fields.**

### 5. LMU install / enable (confirmed from community + CrewChief; LIVE-VERIFY paths)

- **DLL:** `rFactor2SharedMemoryMapPlugin64.dll` (the 64-bit build; LMU is x64-only). A
  known-good copy ships inside CrewChief at
  `…/CrewChiefV4/plugins/rFactor 2/Bin64/Plugins/rFactor2SharedMemoryMapPlugin64.dll`, or
  download from the plugin's GitHub releases.
- **Install folder (LMU):** `…/steamapps/common/Le Mans Ultimate/Plugins/`
  (community thread says `Le Mans Ultimate\Plugins`; create the folder if it doesn't exist).
  rF2's equivalent is `Bin64/Plugins`. **LIVE-VERIFY** the exact folder on the current LMU
  build — both `Plugins` and `Bin64/Plugins` have been reported across builds.
- **Enable:** edit
  `…/Le Mans Ultimate/UserData/player/CustomPluginVariables.JSON` and set
  `"rFactor2SharedMemoryMapPlugin64.dll": { " Enabled": 1, "EnableDirectMemoryAccess": 1, … }`.
  Note the **leading space** in the `" Enabled"` key (rF2/LMU quirk). The entry is usually
  auto-created the first time the game launches and closes with the DLL present; if not,
  add it by hand. `EnableDirectMemoryAccess: 1` is needed for some Extended-buffer extras.
- **Runtimes:** the LMU thread notes installing the game's VC++ runtimes (in the LMU
  `Support` folder) is often the missing step when the plugin isn't recognized.
- **Compatibility:** community confirms the plugin works with LMU as of Apr 2025; treat
  current-build compatibility as **LIVE-VERIFY** given LMU updates frequently.

### 6. Units / conventions for the dump (from header semantics)

- **Tire tread/carcass/inner-layer temps and brake temp:** **Kelvin** → subtract 273.15 for °C.
- **Engine water/oil temps:** **°C already** (rF2 reports these in Celsius, unlike tire/brake).
  LIVE-VERIFY both — sanity-check against in-game HUD.
- **Tire pressure:** **kPa** (×0.145 for psi if needed).
- **Fuel / fuel capacity:** **liters**.
- **Wear:** `mWear` ~`0..1`; rF2 convention **1.0 = new / 0.0 = worn** — VERIFY direction live.
- **Wheel array order:** `mWheels[4]` = **[FL, FR, RL, RR]**.
- **Speed:** magnitude of `mLocalVel` (m/s) → ×3.6 km/h.
- **Gear:** `-1` reverse, `0` neutral, `1..` forward.

### koffi type-mapping cheat sheet

| C++ (rF2State.h) | bytes | koffi type | notes |
| --- | --- | --- | --- |
| `double` | 8 | `double` | majority of physics fields |
| `float` | 4 | `float` | a few (steering ranges, pit dists) |
| `long` / `unsigned long` | 4 | `int32` / `uint32` | **Win64 LLP64: `long` is 32-bit** |
| `int` (`mBytesUpdatedHint`) | 4 | `int32` | |
| `short` / `unsigned short` | 2 | `int16` / `uint16` | |
| `unsigned char` | 1 | `uint8` | counts, indices, enums, expansion pads |
| `signed char` | 1 | `int8` | flags (`mYellowFlagState`, `mSector`, …) |
| `bool` | 1 | `uint8` (read as bool) | C++ `bool` is 1 byte here |
| `char[N]` | N | fixed `char` array → decode ANSI, trim at NUL | names/classes |
| `ULONGLONG` | 8 | `uint64` | Extended tick fields |
| `rF2Vec3` | 24 | nested struct of 3 `double` | |
| `mVersionUpdateBegin/End` | 4 each | `uint32` | torn-read counters |

**Whole-buffer strategy:** define the *entire* wrapper struct (`rF2Telemetry`,
`rF2Scoring`) so a single `MapViewOfFile` + one `koffi.decode` gives the full frame; then
index `mVehicles[0..mNumVehicles-1]`. Keep it allocation-light per docs/CLAUDE.md hot-path
rules.

### What still REQUIRES live in-game verification (user must run on the rig)

Desk research cannot read live memory. The user must, in an actual LMU session:
1. Confirm the install folder + that `CustomPluginVariables.JSON` gains the enabled entry,
   and that the four MMF names (`$rFactor2SMMP_Telemetry$`, `_Scoring$`, `_Extended$`,
   `_Rules$`) actually appear (e.g. dump shows non-zero `mVersionUpdateBegin`).
2. Confirm a sanity set of fields reads correctly with **pack=4**: `mTrackName`,
   `mEngineRPM`, `mFuel`, `mGear`, `mWheels[*].mPressure`/`mTemperature`/`mBrakeTemp`,
   and scoring `mNumVehicles`, `mPlace`, `mVehicleClass`, `mLapDist`, gaps.
3. Confirm units (Kelvin vs °C per field, kPa, liters) and `mWear` direction against HUD.
4. Confirm whether LMU populates: `mRearBrakeBias`, `mFuelCapacity`, tire compound
   *names*, `mEngineMaxRPM`, hybrid/battery fields (`mBatteryChargeFraction` etc.), and
   `rF2Extended.mPhysics` aid flags. Establishes S3 (aids readability) on the rig.
5. Confirm whether the in-cockpit TC/ABS/engine-map *index* is anywhere in SHM (likely
   not) — if absent, route S3 to REST (S2) / setup file (S4).

## Open questions for the spikes (track here)

- [ ] **S1** Plugin install path + enable flags for current LMU build; populated fields.
  - *desk-research (confirmed from source — see "S1 desk-research findings"):* DLL is
    `rFactor2SharedMemoryMapPlugin64.dll`, installed into `…/Le Mans Ultimate/Plugins/`
    (create if absent; rF2 used `Bin64/Plugins` — exact LMU folder is LIVE-VERIFY). Enabled
    via `…/Le Mans Ultimate/UserData/player/CustomPluginVariables.JSON` →
    `"rFactor2SharedMemoryMapPlugin64.dll": { " Enabled": 1, "EnableDirectMemoryAccess": 1 }`
    (note the leading space in `" Enabled"`); entry auto-created on first launch/close, else
    add by hand; install LMU's VC++ runtimes if the plugin isn't recognized. MMF names,
    torn-read fields, struct layouts and pack=4 all confirmed from `rF2State.h` /
    `rF2Data.cs`. **STILL NEEDS LIVE VERIFICATION:** exact install folder on the current
    build, and *which fields LMU actually populates vs. zeroes* — desk research cannot read
    live memory. Source: rF2SharedMemoryMapPlugin repo; CrewChief rF2 page; LMU community
    thread (links in findings subsection).
- [ ] **S1** Are TC/ABS/brake-bias current values readable from telemetry? Where?
  - *desk-research (confirmed from source):* **Brake bias IS in telemetry** —
    `rF2VehicleTelemetry.mRearBrakeBias` (`double`, fraction). **TC/ABS/engine-map current
    *levels* are NOT in the per-vehicle telemetry struct.** `rF2Extended.mPhysics`
    (`rF2PhysicsOptions`) carries only sim driving-aid *difficulty* flags
    (`mTractionControl`, `mAntiLockBrakes`, `mStabilityControl` as `unsigned char`) — **not**
    the in-car TC1–6 / ABS / engine-map *index* the driver toggles on the wheel. So the
    cockpit aid *levels* likely come from the REST API (S2) or the setup file (S4).
    **NEEDS LIVE VERIFICATION:** that LMU populates `mRearBrakeBias`, and whether any
    extended/REST field exposes the current TC/ABS/map index in LMU. See S3.
- [ ] **S2** REST base URL/port, endpoint list, payload schemas, read-only?
- [ ] **S2** Best source for tire compound + available tire sets (SHM vs REST).
  - *desk-research (confirmed from source):* SHM telemetry declares compound fields —
    `mFront/RearTireCompoundIndex` (`unsigned char`) and `mFront/RearTireCompoundName[18]`
    (`char`) on `rF2VehicleTelemetry`; **not** in Extended. Whether LMU fills the *name*
    strings (rF2 often left them blank) is LIVE-VERIFY; REST may still be the better source
    for *available* tire sets. Source: `rF2State.h`.
- [ ] **S3** Are current TC/ABS/brake-bias/engine-map values *readable* (telemetry/extended buffer or setup file)? (Read-only — we never write them.)
  - *desk-research (confirmed from source):* see the second S1 item above. Summary: brake
    bias = telemetry (`rF2VehicleTelemetry.mRearBrakeBias`); TC/ABS *difficulty* flags =
    `rF2Extended.mPhysics`; in-cockpit TC/ABS/engine-map *index* = not found in SHM,
    therefore route to REST (S2) or setup file (S4). All LIVE-VERIFY on the rig (population +
    semantics). Source: `rF2State.h`.
- [ ] **S4** Setup file location + format for **read-only** parsing (and/or REST setup read).
- [ ] Multi-class specifics: class names/IDs for Hypercar / LMP2 / GTE-GT3 as reported.
  - *desk-research:* class name is per-vehicle `rF2VehicleScoring.mVehicleClass[32]` (ANSI
    string). The exact strings LMU emits (e.g. "Hypercar"/"LMP2"/"GTE") are LIVE-VERIFY from
    a multi-class session dump. Source: `rF2State.h`.
- [ ] FCY / safety-car / pit-rules representation (for strategy opportunism).
  - *desk-research:* `rF2ScoringInfo.mGamePhase`, `mYellowFlagState`, `mSectorFlag[3]`;
    per-vehicle `mUnderYellow`, `mFlag`; plus LSI message strings in `rF2Extended`
    (`mLSIPhaseMessage`, `mLSIPitStateMessage`, …) and the `$rFactor2SMMP_Rules$` buffer.
    Enum meanings + which LMU populates are LIVE-VERIFY. Source: `rF2State.h`.
- [ ] **S5** Plugin license + whether we may bundle/auto-install it into LMU's plugins folder, or must guide manual install. ([16-PLATFORM-PREREQUISITES.md](16-PLATFORM-PREREQUISITES.md))
- [ ] **S6** Reading the wheel via SDL2 while LMU holds the device (shared vs exclusive); device-GUID stability across reconnects. ([16-PLATFORM-PREREQUISITES.md](16-PLATFORM-PREREQUISITES.md))
- [ ] Coexistence with other readers (SimHub/CrewChief) on the same memory-mapped files.
  - *desk-research:* MMFs are shared read-only maps; multiple readers (CrewChief, SimHub,
    TinyPedal) coexist fine in practice since none of them *write* the read buffers. No
    exclusivity issue expected for our read-only reader. LIVE-VERIFY harmless coexistence
    with CrewChief running simultaneously.
