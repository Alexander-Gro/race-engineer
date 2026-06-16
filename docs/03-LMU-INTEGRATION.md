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
>
> **Offline half built (T8.1, 2026-06-16):** a tolerant `aidsFromRest(garage, repairRefuel)` +
> `withAidsFromRest(state, rest)` (`packages/adapters/lmu/src/rest/aids.ts`) probes the REST garage
> payloads for TC/ABS/engine-map indices and fills only the canonical aid fields SHM left null
> (prefer-SHM; brake bias stays SHM-sourced). Field names are LIVE-VERIFY. **Rig steps:** capture
> `/rest/garage/getPlayerGarageData` + `/rest/garage/UIScreen/*` JSON, confirm where the aid indices
> live + their key names, narrow the candidate lists; if REST doesn't expose them, add the setup-file
> (S4) fallback once `T9.1`'s parser lands. (The `pnpm capture` script will dump these in one pass.)

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

## S1 — live confirmation (2026-06-14)

The standalone dump (`pnpm shm-dump`) was run against a live LMU session (GT3 at
Circuit de la Sarthe, solo practice, stationary in the pits). **The plugin works and
the `pack=4` struct decode is correct for this build** — every sampled field read sane
and consistent with the in-game state, with no shifted/garbage/NaN values. This
validates the S1 assumptions and de-risks the real adapter (T2.x); the remaining
unchecked items below need a *moving, multi-class* session.

**Confirmed working (live)**
- Plugin loads; `$rFactor2SMMP_Telemetry$` and `$rFactor2SMMP_Scoring$` both open
  (`telemetry=true scoring=true`). The DLL was already present in the LMU folder.
- `pack=4` offsets are correct across telemetry + scoring (no garbage/shift/NaN).
- Populated & correct: track name + length (`Circuit de la Sarthe`, 13624 m), driver
  name, **vehicle class `GT3`**, fuel + capacity (22.8 / 117 L), engine RPM + **max RPM**
  (1997 / 9400), gear, **brake bias (`mRearBrakeBias`) = 52.5%**, engine water temp
  (79 °C), per-wheel temps / pressure (166 kPa) / wear / brake temp, and **tyre
  compound name strings** (`Medium`).
- Units verified: tyre & brake temps are Kelvin in the buffer → °C conversion correct;
  engine water temp already °C; pressure kPa; fuel litres.
- **Wear direction confirmed: 1.0 = new** (fresh tyres read `wear=1.00`).
- **S3 (partial): current brake bias IS readable from telemetry.** TC/ABS/engine-map
  *index* was not exercised (single static read) — still route via REST (S2) / setup (S4).

**Still to verify (needs a moving / multi-class session)**
- Dynamic fields while driving: speed (read 0 while stationary), lap times
  (`last`/`best` were `0.000`/`-1.000` = "no lap yet"), `mLapDist`, gaps.
- Multi-class class strings (only solo `GT3` seen) — confirm the exact Hypercar / LMP2 /
  GTE strings in a multi-class grid (needed for the schema mapping in T2.3).
- FCY / yellow / pit-state enum values (`mGamePhase`, `mYellowFlagState`, `mPitState`).
- `best=-1.000` / `last=0.000` are rF2 "no time yet" sentinels — the Normalizer (T2.3)
  maps these to null.

> Capture artifact: `°`/`ø` shown as `┬░`/`├©` in the saved file is a console code-page
> display issue (UTF-8 viewed as CP1252), not a decode error.

## S1 — live confirmation #2 (moving, multi-class — 2026-06-14)

Full-grid moving capture via the enhanced all-vehicles dump
(`pnpm shm-dump --frames 150 --hz 5`, GT3 starting P53 at Circuit de la Sarthe, **53 cars**,
race green-flag start). Closes most of the "still to verify" list above.

**Confirmed (live)**
- **Multi-class `mVehicleClass` strings are exactly `Hyper`, `LMP2`, `GT3`** (note: **not**
  `Hypercar`/`GTE` as the desk-research assumed) — these are the literal strings T2.3 maps to
  canonical `className`/`classId`.
- **Dynamic fields populate while moving:** player speed 0→**229 kph**, gears to 6, RPM
  6960/9400, `mLapDist` advancing (−293 → 522 m, negative = behind the start line on the
  formation/first lap), and per-car `mTimeBehindLeader`/`mTimeBehindNext` gaps changing
  frame-to-frame. So speed/dist/gaps are good.
- **`mPathLateral` is populated and dynamic** (player 7.70 on grid → −2.24 → −4.34 on track;
  field spans roughly ±5.5 across the grid). Confirms the field exists for spotter geometry.
- Telemetry (GT3): fuel **84.0/117 L**, **brake bias 48.0%**, 3-zone tyre temps, pressure
  ~166 kPa, **wear 1.00 (new)**, brake temps, **compound name `Medium`** front/rear.
- `mGamePhase = 5` (green/racing) and `mYellowFlagState = 0` throughout; `mSectorFlag`
  observed values **1 and 11** (e.g. `[1,11,1]`, `[11,11,11]`) — enum meanings TBD.

**Still open (need another capture)**
- **Lap-time population:** player never completed a lap in the 30 s window (`lap=0`
  throughout), so `mLastLapTime`/`mBestLapTime` stayed at the `0.000`/`-1.000` sentinels —
  populated values still unconfirmed live (low risk; sentinels → null in T2.3).
- **FCY / yellow / pit-state enums:** none occurred (clean green, no pit stops) — capture a
  session with a full-course yellow and a pit entry to read `mGamePhase`/`mYellowFlagState`/
  `mPitState`/`mUnderYellow`/`mFlag` enum values.
- **Spotter lateral sign:** `mPathLateral` is each car's offset from the track centerline
  (not relative to the player), and no annotated side-by-side was captured, so the spotter's
  `+lateral = driver's right` assumption (T3.4) is **not yet confirmed** — needs a capture
  where the user notes "car was on my left/right" so we can check the sign of
  `rival.mPathLateral − player.mPathLateral`.
- **Brake-bias front/rear:** the field is `mRearBrakeBias` but reads ~48–52% — confirm
  against the in-game HUD whether this is the front or rear figure so T2.3 maps
  `aids.brakeBias.frontPct` correctly.

## S1 — live confirmation #3 (recorded multi-class stint — 2026-06-15)

First capture via **`pnpm record`** — so this validates the **canonical `RaceState`** (post-Normalizer,
what the app/strategy actually consume), not raw struct fields. GT3 in a **53-car, 3-class**
(`Hyper`/`LMP2`/`GT3`) race at Circuit de la Sarthe; ~10 min, **6400 frames @ 10 Hz**; the driver
toggled TC/ABS/brake-bias on the fly. (164 MB raw — git-ignored, never committed.)

**Confirmed (canonical)**
- **Gap sign — CONFIRMED `− = ahead, + = behind`.** Cross-checked against race position over all 6400
  frames: the car at `position − 1` (immediately ahead) had **negative `gapToPlayerS` in 6391/6400
  frames (99.9%)**; the car at `position + 1` (behind) was **positive in 4922/4973 (99%)**. So the
  undercut ahead/behind split (T7.4) and traffic forecasting (T7.5) use the right sign. ✓
- **Lap times populate** — `lastLapS`/`bestLapS` non-null in 5468/6400 frames (after the first of 3
  completed laps); sentinels → null correctly. ✓ (closes the S1#2 open item)
- **Multi-class** `Hyper`/`LMP2`/`GT3` across 52 distinct cars. ✓
- **Brake bias reads and tracks adjustments** — `aids.brakeBias.frontPct` moved **52.50 → 53.25** as the
  driver changed it (canonical; raw `mRearBrakeBias` ~47–48 ⇒ Normalizer reports `frontPct ≈ 100 − rear`).
- **Fuel reads** — full tank **84 L** (23/6400 frames glitched transiently to `0`).

**New findings**
- **TC / ABS / engine map are NOT readable** — `aids.tc`, `aids.abs`, `engine.map` were **null in all
  6400 frames even though the driver toggled them live.** Definitive: not in the telemetry/scoring
  buffers we decode today, so the dashboard correctly shows "—"; reading them is outstanding **S3** work.
  Brake bias is the only aid currently read.
- **`closingRateMps` has outlier spikes** — ~**14.5%** of per-car samples exceed `|50 m/s|` (up to
  ±167 m/s), concentrated on **distant cars near the lap boundary** (gaps > 1 km): the
  `(|prevGap| − |gap|)/dt` derivation spikes when the gap jumps discontinuously. The bulk (59% < 10 m/s)
  is clean, and T7.5 only reads near cars, so the practical impact is small — but the field should be
  **clamped/filtered in the Normalizer** (follow-up task).
- **Fuel-per-lap / strategy did not compute** — only 3 laps + the 23 zero-fuel glitches starved the
  rolling per-lap delta (`perLapAvgLiters`/`lapsRemainingEst` stayed null). Needs a clean multi-lap green
  run; the zero-glitches are worth guarding in the Normalizer.

**Still open**
- **Spotter lateral *sign*** — `lateralPos` reads (±13–17 m); the real `spotterRule` now runs over the
  committed fixture and emits `car_left`/`car_right` on the side-by-side, so the rule is validated on real
  data — only `left = physical-left` still wants one annotated "car on my left at mm:ss" frame (low risk).
- **FCY / pit enums** — clean green throughout, no pit stop; still need a yellow + pit session.

**Resolved (2026-06-15, post-analysis)**
- **Brake-bias front/rear — CONFIRMED:** user verified **52.5 = front** in the LMU garage, matching our
  `frontPct` (= raw `mRearBrakeBias × 100` — the rF2 field, despite its `Rear` name, ×100 gives the front
  %). Mapping correct as-is.
- **Closing-rate spikes — FIXED in the Normalizer:** implausible rates (`|rate| > 100 m/s`, the S/F-wrap
  artifacts) are now reported `null`; see `MAX_PLAUSIBLE_CLOSING_RATE_MPS`.
- **Fixture committed (T1.5):** a 60-frame multi-class slice →
  `packages/adapters/sim-replay/fixtures/lemans-multiclass.replay.jsonl`, replay-tested (schema + the
  spotter on real traffic).

## Rig verification backlog (consolidated)

> Single actionable list for the next rig session(s). Pulls together the still-open spike
> items above plus the new dependencies introduced by the M7 strategy work (T7.2–T7.5).
> Tick items here and write the result back into the relevant spike section. Track-B pointer
> lives in [14-BUILD-PLAN.md](14-BUILD-PLAN.md).

### A. Signs & conventions (cheap to confirm; high blast-radius if wrong)
- [x] **Gap sign** `gapToPlayerS` / `gapToPlayerM` is **+ = behind / − = ahead** — **CONFIRMED S1#3**
  (cross-checked vs race position over 6400 frames: car ahead 99.9% negative, car behind 99% positive).
  Underpins the undercut ahead/behind split (T7.4) and traffic forecasting (T7.5).
- [~] **Spotter lateral sign** `+mPathLateral = driver's right` (T3.4 `rightIsPositive`) — the real
  `spotterRule` runs over the S1#3 fixture and emits `car_left`/`car_right` on real side-by-side traffic
  (validated on real data); only `left = physical-left` still wants one annotated "car on my left" frame.
- [x] **Brake-bias front/rear** — **CONFIRMED S1#3**: user verified **52.5 = front** in the garage,
  matching our `frontPct` (= raw `mRearBrakeBias × 100`; the rF2 field's `Rear` name is a misnomer).
- [x] **Closing-rate end-to-end** — `closingRateMps` (`(|prevGap| − |gap|)/dt`, **+ = closing**) computes;
  S1#3 found **~14.5% outlier spikes** (S/F-wrap artifacts) → **FIXED**: the Normalizer now clamps
  `|rate| > MAX_PLAUSIBLE_CLOSING_RATE_MPS (100)` to `null`. Near-car values (what T7.5 uses) were clean.

### B. Enums & sentinels (need the right session to occur)
- [ ] **FCY / yellow / pit-state enums** `mGamePhase` / `mYellowFlagState` / `mPitState` /
  `mUnderYellow` / `mFlag` — capture a session with a full-course yellow and a pit entry.
  Gates the FCY/SC opportunism work (T7.6) and `flags.global` mapping (T2.3).
- [ ] **Sector-flag enum** `mSectorFlag` (observed 1 and 11) — decode meanings.
- [x] **Lap-time population** — **CONFIRMED S1#3**: `lastLapS`/`bestLapS` populate with real values
  after the first completed lap (5468/6400 frames non-null); sentinels → null correctly.

### C. Strategy-model calibration inputs (real values the pure models need to be *useful*)
> The T7.x models are unit-tested with caller-supplied numbers; in production these inputs
> must come from telemetry / REST / session rules per car·track·series. Source them on the rig.
- [ ] **Pit-lane time loss per track** (T7.2 `pitLaneTimeLossS`) — measure pit entry→exit vs
  the on-track equivalent (`estimatePitLaneTimeLossS`); store per track.
- [ ] **Refuel rate (L/s) + tyre-change time (s)** (T7.2 `serviceTime`) — per car/series;
  check the REST `RepairAndRefuel` / `strategy/usage` payloads (S2) or measure a stop.
- [ ] **Virtual Energy** mapping (endurance fuel/energy) from REST `strategy/usage` (S2.2) —
  whether fuel-to-finish should be energy-based for Hypercar. **Offline half done (T11.3):** the
  canonical `PlayerCar.virtualEnergy` field, the strategy/engine/dashboard/AI VE path (M11), and a
  **tolerant REST→VE mapper** `virtualEnergyFromRest(strategyUsage, repairRefuel)` +
  `withVirtualEnergyFromRest(state, rest)` (`packages/adapters/lmu/src/rest/virtual-energy.ts`) all
  exist and are unit-tested. **Rig steps still needed:**
  1. On the rig, GET `/rest/strategy/usage` and `/rest/garage/UIScreen/RepairAndRefuel` (Swagger/curl,
     in-session) and **record the real JSON** — pin the actual field names + whether VE is a % (0..100)
     or a 0..1 fraction. Then narrow the mapper's `LEVEL_KEYS`/`PER_LAP_KEYS` candidate lists to the
     confirmed keys (the `toFraction01` heuristic already handles either scale).
  2. Wire the live poll: in `apps/desktop/src/lmu-host.ts`, poll the REST client at ~2 Hz **off the
     50 Hz SHM hot path**, cache the latest VE, and merge it into each normalized `RaceState` via
     `withVirtualEnergyFromRest` (never block the telemetry loop on network I/O — CLAUDE.md rule 3).
  3. Confirm in-app: the dashboard Virtual Energy card populates and the "Energy-limited" badge shows
     when VE binds before fuel.
- [ ] **Tyre life / max-stint-laps** (T7.3 `maxStintLapsByTire`) and **fresh-vs-worn pace
  delta** (T7.4 `freshTyreGainPerLapS`) — derive from a real green stint (feeds T7.1 fit;
  needs the T1.5 recording).
- [ ] **Mandatory stops / driver-change / min-drive-time rules** (T7.3 `mandatoryStops`) —
  from the session rules / REST `sessions` payload.

### D. Live end-to-end (already on Track B)
- [x] **T1.5** record a real green stint → commit a trimmed fixture — **done S1#3**
  (`packages/adapters/sim-replay/fixtures/lemans-multiclass.replay.jsonl`, replay-tested). A longer
  *clean multi-lap* stint is still wanted for the tyre/pace calibration (§C) + replay-eval of T7.1/T7.3.
- [ ] **Multi-lap stint with real fuel burn → run the T10.4 eval.** The committed fixture is a
  60-frame side-by-side slice (flat fuel, no lap completes), so the `@race-engineer/eval`
  fuel-accuracy *numbers* run today only on synthetic ground truth; the real flat-fuel slice
  correctly reports **silent**. To close the docs/10 Phase-2 gate ("fuel-to-finish within ±1 lap by
  mid-stint **on a recorded endurance race**"), capture a ~5–10-lap green stint with fuel
  decrementing (`pnpm record --frames N`), commit a trimmed copy, then `pnpm eval replay <file>` —
  it scores the live `StrategyEngine` vs the recording's own measured per-lap burn. Same recording
  also feeds §C tyre/pace calibration.
- [ ] **T2.2 live** REST probe → capture Swagger payloads → finish Virtual-Energy + pit/refuel
  mapping into `RaceState`.
- [ ] **T1.3 / T1.4** current-aid (TC/ABS/engine-map index) + setup-file reads (S3/S4).

## S2 / S4 desk-research findings (verify live)

> **Status:** transcribed from public community/tool sources as of 2026-06-14. Base
> URL/port, the *existence* and *paths* of several endpoints, and the `.svm` file location
> + format below are **confirmed from public sources** (community tools that call them).
> What is **NOT** confirmable by desk research — and is flagged `LIVE-VERIFY` — is the exact
> JSON payload *shape/field names* of each endpoint on the current LMU build, the *full*
> endpoint list (only the Swagger page on the running game is authoritative), and whether a
> given endpoint exists/changed on the user's build. The REST API is **unofficial,
> undocumented, and version-fragile** (it changed across game updates — see v1.3.3 note).
> The user must run the probe commands at the end on the rig to confirm.
>
> **Sources (public):**
> - LMU community "REST API documentation" thread (base URL, Swagger, `getAllVehicles`,
>   IPv4-vs-IPv6 `[::1]` quirk):
>   <https://community.lemansultimate.com/index.php?threads/rest-api-documentation.3278/>
> - lmu-pitwall (Rust+React; SHM + REST; exact endpoints `/rest/strategy/usage`,
>   `/rest/garage/UIScreen/RepairAndRefuel`): <https://github.com/Swizzjack/lmu-pitwall>
> - TinyPedal (OSS overlay; LMU REST connector, `enable_restapi_access`, RepairAndRefuel as
>   the "only" source for energy/brake-wear/damage/pit): <https://github.com/TinyPedal/TinyPedal>
>   and User-Guide wiki <https://github.com/TinyPedal/TinyPedal/wiki/User-Guide>
> - CrewChief V4 — uses LMU's REST API to read fuel level + fuel/damage multipliers **and
>   to *set* the pit menu** (a WRITE path we avoid); property is off by default ("problematic
>   REST API"): <https://github.com/mrbelowski/CrewChiefV4> and
>   <https://mr_belowski.gitlab.io/CrewChiefV4/About_ChangeLog.html>
> - DR Sim Manager LMU source notes (REST `:6397` + SHM):
>   <https://docs.departedreality.com/dr-sim-manager/general/sources/le-mans-ultimate>
> - LMUSessionTracker (live timing/standings via REST): <https://github.com/mbeader/LMUSessionTracker>
> - LMUTools (REST-based tools): <https://github.com/JeGoBE8900/LMUTools>
> - Setup `.svm` location: simracingsetup.com install guide
>   <https://simracingsetup.com/le-mans-ultimate/how-to-install-lmu-setups/> and
>   seralaci/Le-Mans-Ultimate-Setups <https://github.com/seralaci/Le-Mans-Ultimate-Setups>
> - `.svm` internal format (text/INI, index-not-value storage, non-reconstructable UI
>   numbers) — LMU community thread "Question about setup .svm files":
>   <https://community.lemansultimate.com/index.php?threads/question-about-setup-svm-files-mapping-settings-to-in-game-options.14332/>

### S2.1 — Base URL / port / discovery (confirmed from source)

- **Base URL:** `http://localhost:6397` (confirmed by the community REST thread, lmu-pitwall,
  TinyPedal, DR Sim Manager). The server is part of LMU's web-based UI and runs whenever the
  game is running; **no extra plugin is required** for the REST API (unlike SHM). Community
  tools "discover" it simply by hard-coding `:6397` — there is no advertised discovery
  mechanism. **LIVE-VERIFY** the port on the current build (some builds/tools have differed).
- **IPv4 vs IPv6 quirk (LIVE-VERIFY):** after a game update, some clients found IPv4
  `localhost`/`127.0.0.1` refused the connection and had to use IPv6 `http://[::1]:6397`.
  Probe **both** on the rig and record which the current build accepts (the adapter should
  try `127.0.0.1` then fall back to `[::1]`).
- **Access changed across versions (LIVE-VERIFY):** TinyPedal notes REST access behaviour
  changed around **game v1.3.3** and that its client needs an explicit `enable_restapi_access`
  toggle. So: (a) the API may require the game to be in a session/garage before endpoints
  populate, and (b) endpoint paths/shapes are not stable across LMU updates. Treat every path
  below as "observed on some build — confirm on yours."
- **Swagger (authoritative on the running game):** `http://localhost:6397/swagger/index.html`
  serves an interactive list of *all* endpoints for the **current** build. This is the
  single best live source of truth for S2 — the rig step is to open it and capture the list.

### S2.2 — Known endpoint paths (confirmed to exist from community tools; payloads LIVE-VERIFY)

All are under the `/rest/` prefix and are **GET** (read) in community usage unless noted.
Payload field names are **LIVE-VERIFY** (capture real JSON on the rig via Swagger / curl).

| Endpoint (verbatim) | Method | What it returns (per tool usage) | Source |
| --- | --- | --- | --- |
| `/swagger/index.html` | GET | Interactive list of all endpoints for the current build | community thread |
| `/rest/sessions` | GET | Session info (root of the sessions tree) | TinyPedal |
| `/rest/sessions/getAllVehicles` | GET | List of installed cars/vehicles | community thread |
| `/rest/sessions/weather` | GET | Track/weather conditions (and likely forecast) | TinyPedal |
| `/rest/strategy/usage` | GET | **Virtual Energy (VE) consumption per lap** — key for LMU energy/fuel strategy | lmu-pitwall |
| `/rest/garage/getPlayerGarageData` | GET | Player garage state (selected car/setup-level context) | TinyPedal |
| `/rest/garage/UIScreen/RepairAndRefuel` | GET | **Pit/strategy menu state**: virtual energy, brake wear, per-area damage (aero/brakes/suspension), refuel/repair selections | lmu-pitwall, TinyPedal |

TinyPedal explicitly calls `RepairAndRefuel` the **only** REST address for getting
energy / brake-wear / vehicle-damage / pit-stop data out of LMU — so for S3-adjacent and
strategy data this endpoint is the priority probe. The Swagger page will reveal the rest of
the `/rest/garage/UIScreen/*` family (other UI screens) and any `/rest/watch/*`
(standings/timing) endpoints — enumerate them live.

> **Not yet pinned (LIVE-VERIFY via Swagger):** a dedicated rich-**standings** endpoint
> (class + gaps) — LMUSessionTracker reads standings over REST but the exact path wasn't
> captured in desk research; standings may also come straight from SHM scoring (already
> live-confirmed in S1), so prefer SHM for standings/gaps and use REST only to fill gaps.
> Also unpinned: an explicit **available tire sets/compounds** endpoint and a **current
> setup state** endpoint (see S4.3). Capture these from the Swagger list on the rig.

### S2.3 — Writes exist; we deliberately do not use them (read-only by design)

**CrewChief uses the LMU REST API to *set the pit menu*** (fuel/repair selections), not just
to read — so **write-capable endpoints exist** (the `/rest/garage/UIScreen/*` "set"
operations and/or `POST`/`PUT` verbs on the garage tree). Per CLAUDE.md rule 5 and doc 03
"We do not write", **we never issue any POST/PUT/mutating REST call.** We only **GET**.
When enumerating Swagger on the rig, **note every non-GET operation and add it to an
avoid-list** in the adapter; the `RestClient` must be hard-restricted to GET. CrewChief
itself ships this behind an off-by-default toggle and calls the API "problematic", which
reinforces: poll gently, GET-only, tolerate failure.

### S2.4 — REST vs shared memory (which source wins)

- **Prefer SHM** (already S1-live-confirmed) for: telemetry physics, positions/gaps,
  class names, lap/sector times, brake bias (`mRearBrakeBias`), and the **current tire
  compound name** (live-confirmed `Medium` from SHM).
- **Prefer REST** for LMU-specific higher-level concepts not in the rF2 struct:
  **Virtual Energy per lap** (`/rest/strategy/usage`) and the **pit/refuel/repair + damage
  + brake-wear menu state** (`/rest/garage/UIScreen/RepairAndRefuel`). VE is an LMU concept
  absent from the rF2 SHM layout, so REST is the primary VE source.
- **For S3 (current TC / ABS / engine-map *index*):** **LIVE-VERIFY** whether
  `/rest/garage/getPlayerGarageData` or a `/rest/garage/UIScreen/*` screen exposes the
  current aid indices. SHM does **not** carry these (S1 finding). If REST also does not,
  fall back to the setup file (S4) for the baseline. This is the open S3 question.
- **For available tire sets/compounds:** SHM gives the *current* compound name; **REST is
  the likely source for the list of available sets** — confirm via Swagger.

### S4.1 — Setup file location (confirmed from source; exact-path LIVE-VERIFY)

LMU inherits rF2's setup storage. **Confirmed from community install guides:**

- **Directory:** `…\steamapps\common\Le Mans Ultimate\UserData\player\Settings\`
  with a **per-track subfolder**, i.e. `…\UserData\player\Settings\<TrackFolder>\`.
  (This differs from the older rF2 `…\Settings\<vehicle>\<track>\` nesting cited in CLAUDE.md
  — for LMU the observed layout is `Settings\<track>\` with the car encoded in the filename.
  **LIVE-VERIFY** the exact nesting on the current build.)
- **Extension:** **`.svm`** (the rF2 setup format).
- **Filename convention (informational, not load-bearing):** community setups use names like
  `Author_Q_COTA_Nat_V2_296_GT3.svm` (author / session use / track-layout / version / car).
  Filenames are author-chosen — **do not parse meaning out of them**; read the file contents
  and cross-reference the car/track from SHM/REST instead.

### S4.2 — `.svm` file format (confirmed from source; semantics LIVE-VERIFY)

The `.svm` is a **human-readable text / INI-style** file (rF2 heritage), safe to open
**read-only**. Confirmed structure from the LMU community format thread:

- **Sections** in square brackets, e.g. `[REARLEFT]`, `[FRONTLEFT]`, `[BODYAERO]`,
  `[GENERAL]`, `[SUSPENSION]`, … (rF2 section names; **LIVE-VERIFY** the exact LMU set).
- **Entries** as `Key=<value>//<trailing comment/display text>` — i.e. a numeric value
  followed by `//` and a human-readable note.
- **CRITICAL — values are indices, not physical numbers.** The file stores a **0-based
  setting index** (or a differential from the default setup), not the degrees/clicks/psi the
  garage UI shows. The in-game value is conceptually `base + (index × step)`, but base/step
  are **per-entry, possibly nonlinear, rounded, and unit-shifted**, and they live in the
  car's data — **not in the `.svm`**. Consequence per the source: *you cannot reliably
  reconstruct the UI numbers from the `.svm` alone.*

**Design implication for `SetupParams` (read-only):**
- The `.svm` parser can reliably extract the **section/key structure and the stored index
  per setting**, and detect **deltas vs. a reference setup** (which index changed).
- It **cannot**, from the file alone, emit "brake bias = 54.5%" or "front wing = 6°"
  reliably. For *current absolute values* prefer the **live sources**: brake bias from SHM
  (`mRearBrakeBias`, S1-confirmed), and TC/ABS/engine-map/tire from **REST/SHM** if exposed.
  Use the `.svm` mainly to know *what setting fields exist* and to express advice as
  **relative clicks** ("TC up one", "brake bias back two clicks") — which matches the
  read-only/advisory model (the driver applies the change in the garage).
- **LIVE-VERIFY on the rig:** the exact section/key names LMU emits, which keys map to
  **TC / ABS / brake bias / engine map / mixture** and to mechanical (springs, ARB, dampers,
  ride height) and aero (wing) settings, and whether any entry stores an absolute value.

### S4.3 — Setup state via REST (alternative read source — LIVE-VERIFY)

`/rest/garage/getPlayerGarageData` and the `/rest/garage/UIScreen/*` screens are the
candidate REST sources for the **currently loaded** setup/aid state (as opposed to the
on-disk `.svm`). Because the REST garage tree is what the in-game garage UI itself binds to,
it is **more likely to expose UI-accurate current values** (including possibly the current
TC/ABS/engine-map index) than the `.svm` file. **This is the most promising route for S3 and
for "current setup" reads — confirm via the Swagger list and capture the JSON on the rig.**

### S2 / S4 live-rig probe list (paste into rig instructions)

Run in **PowerShell** with LMU **running and sitting in the garage / an active session**
(many endpoints only populate in-session). `Invoke-RestMethod` auto-parses JSON; pipe to
`ConvertTo-Json -Depth 8` to see the full shape, and to a file to capture a fixture.

```powershell
# 0. Connectivity — try IPv4 first, then IPv6 fallback. Record which works.
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:6397/rest/sessions
curl.exe -s -o NUL -w "%{http_code}`n" "http://[::1]:6397/rest/sessions"
$BASE = "http://localhost:6397"   # swap to http://[::1]:6397 if only IPv6 answered

# 1. AUTHORITATIVE endpoint list for THIS build — open in a browser and copy every path:
Start-Process "$BASE/swagger/index.html"
#    (also grab the machine-readable spec if present:)
Invoke-RestMethod "$BASE/swagger/v1/swagger.json" | ConvertTo-Json -Depth 12 > $env:USERPROFILE\Desktop\lmu_swagger.json

# 2. Capture each known endpoint's real payload (these become test fixtures):
Invoke-RestMethod "$BASE/rest/sessions"                         | ConvertTo-Json -Depth 8 > $env:USERPROFILE\Desktop\lmu_sessions.json
Invoke-RestMethod "$BASE/rest/sessions/getAllVehicles"         | ConvertTo-Json -Depth 8 > $env:USERPROFILE\Desktop\lmu_vehicles.json
Invoke-RestMethod "$BASE/rest/sessions/weather"                | ConvertTo-Json -Depth 8 > $env:USERPROFILE\Desktop\lmu_weather.json
Invoke-RestMethod "$BASE/rest/strategy/usage"                  | ConvertTo-Json -Depth 8 > $env:USERPROFILE\Desktop\lmu_strategy_usage.json
Invoke-RestMethod "$BASE/rest/garage/getPlayerGarageData"      | ConvertTo-Json -Depth 8 > $env:USERPROFILE\Desktop\lmu_garage.json
Invoke-RestMethod "$BASE/rest/garage/UIScreen/RepairAndRefuel" | ConvertTo-Json -Depth 8 > $env:USERPROFILE\Desktop\lmu_repairrefuel.json

# 3. S3 hunt — in the captured garage / RepairAndRefuel JSON, search for the current
#    aid indices and tire sets (field names are unknown; grep broadly):
Select-String -Path $env:USERPROFILE\Desktop\lmu_garage.json,$env:USERPROFILE\Desktop\lmu_repairrefuel.json `
  -Pattern "(?i)traction|TC|ABS|antilock|brakebias|brake.?bias|enginemap|engine.?map|mixture|map|compound|tireset|tyre|fuel|energy"

# 4. S4 setup file — confirm location, extension, and dump one file's text:
$SET = "$env:ProgramFiles(x86)\Steam\steamapps\common\Le Mans Ultimate\UserData\player\Settings"
Get-ChildItem -Path $SET -Recurse -Filter *.svm | Select-Object FullName, Length, LastWriteTime
#    Open the most-recent .svm and inspect sections/keys (look for TC/ABS/brake-bias/map):
Get-ChildItem -Path $SET -Recurse -Filter *.svm | Sort-Object LastWriteTime -desc |
  Select-Object -First 1 | Get-Content | Select-Object -First 120
```

> READ-ONLY contract for the probe: every command above is a **GET** (or a file read). Do
> **not** add `-Method Post/Put` to any `/rest/garage/...` call — those mutate the pit menu
> (the CrewChief write path) and are out of scope by design. If a path 404s, the build
> renamed/removed it — fall back to the Swagger list from step 1.

## Open questions for the spikes (track here)

- [x] **S1** Plugin install path + enable flags for current LMU build; populated fields.
  **LIVE-CONFIRMED 2026-06-14** (see "S1 — live confirmation"): plugin loads, both maps
  open, `pack=4` decode correct, and the sampled telemetry/scoring fields populate
  correctly on a GT3 at Le Mans. (Multi-class strings + moving/dynamic fields still pending.)
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
- [x] **S1** Are TC/ABS/brake-bias current values readable from telemetry? Where?
  **LIVE-CONFIRMED 2026-06-14:** brake bias reads correctly from telemetry
  (`mRearBrakeBias` = 52.5% on a GT3). TC/ABS/engine-map *index* remains not-in-SHM
  (route via REST S2 / setup S4) — not yet exercised live.
  - *desk-research (confirmed from source):* **Brake bias IS in telemetry** —
    `rF2VehicleTelemetry.mRearBrakeBias` (`double`, fraction). **TC/ABS/engine-map current
    *levels* are NOT in the per-vehicle telemetry struct.** `rF2Extended.mPhysics`
    (`rF2PhysicsOptions`) carries only sim driving-aid *difficulty* flags
    (`mTractionControl`, `mAntiLockBrakes`, `mStabilityControl` as `unsigned char`) — **not**
    the in-car TC1–6 / ABS / engine-map *index* the driver toggles on the wheel. So the
    cockpit aid *levels* likely come from the REST API (S2) or the setup file (S4).
    **LIVE-CONFIRMED (S1#3, 2026-06-15):** `mRearBrakeBias` **populates** (canonical `frontPct`
    52.5–53.25, tracks the driver's adjustments), and **TC/ABS/engine-map stayed `null` even while the
    driver toggled them on the wheel** — so the cockpit aid *levels* are confirmed **not** in telemetry
    and must come from REST (S2) or the setup file (S4). **Front-vs-rear CONFIRMED:** user verified
    52.5 = front, matching our `frontPct` (= `mRearBrakeBias × 100`). See S3 / S1#3.
- [ ] **S2** REST base URL/port, endpoint list, payload schemas, read-only?
  - *desk-research (confirmed from public tool sources — see "S2 / S4 desk-research
    findings"):* **Base URL `http://localhost:6397`** (corroborated by the LMU community REST
    thread, lmu-pitwall, TinyPedal, DR Sim Manager); **no extra plugin needed** for REST.
    **IPv4-vs-IPv6 quirk:** some builds refuse `127.0.0.1` and need `http://[::1]:6397`.
    **Endpoints confirmed to exist:** `/rest/sessions`, `/rest/sessions/getAllVehicles`,
    `/rest/sessions/weather`, `/rest/strategy/usage` (Virtual Energy per lap),
    `/rest/garage/getPlayerGarageData`, `/rest/garage/UIScreen/RepairAndRefuel`
    (energy/brake-wear/damage/pit menu — TinyPedal's "only" source for that data), plus
    `/swagger/index.html` (authoritative full list on the running game).
    **Read-only?** Mostly GET, BUT **write-capable endpoints exist** — CrewChief uses REST to
    *set the pit menu* (POST/PUT on the garage tree). **We never call those; RestClient is
    GET-only.** **NEEDS LIVE VERIFICATION:** the *full* endpoint list (open Swagger on the
    rig), the **payload field names/shapes** of each endpoint, the working IP form, the port
    on the current build, and whether endpoints populate only in-session (REST access changed
    around game v1.3.3). Probe list provided in the findings section. Sources: LMU community
    REST thread; lmu-pitwall; TinyPedal; CrewChief; DR Sim Manager.
- [ ] **S2** Best source for tire compound + available tire sets (SHM vs REST).
  - *desk-research (confirmed from source):* SHM telemetry declares compound fields —
    `mFront/RearTireCompoundIndex` (`unsigned char`) and `mFront/RearTireCompoundName[18]`
    (`char`) on `rF2VehicleTelemetry`; **not** in Extended. **LIVE-CONFIRMED 2026-06-14:**
    LMU *does* populate the compound name strings (read `Medium` front/rear on a GT3), so
    SHM is a viable source for the *current* compound; REST may still be better for
    *available* tire sets. Source: `rF2State.h`.
    - *S2 desk-research addendum:* SHM = best for the **current** compound (live-confirmed).
      For the **list of available tire sets/compounds**, REST is the likely source but **no
      specific endpoint was pinned in desk research** — `/rest/garage/getPlayerGarageData`
      or a `/rest/garage/UIScreen/*` screen are the candidates. **NEEDS LIVE VERIFICATION:**
      find the available-sets endpoint in the Swagger list and capture its payload. Source:
      TinyPedal (RepairAndRefuel/garage usage); LMU community REST thread.
- [ ] **S3** Are current TC/ABS/brake-bias/engine-map values *readable* (telemetry/extended buffer or setup file)? (Read-only — we never write them.)
  - *desk-research (confirmed from source):* see the second S1 item above. Summary: brake
    bias = telemetry (`rF2VehicleTelemetry.mRearBrakeBias`); TC/ABS *difficulty* flags =
    `rF2Extended.mPhysics`; in-cockpit TC/ABS/engine-map *index* = not found in SHM,
    therefore route to REST (S2) or setup file (S4). All LIVE-VERIFY on the rig (population +
    semantics). Source: `rF2State.h`.
    - *S2/S4 desk-research addendum:* **Brake bias is solved via SHM (live-confirmed).** For
      the **TC / ABS / engine-map *index***, the best desk-research candidate is the **REST
      garage tree** — `/rest/garage/getPlayerGarageData` and `/rest/garage/UIScreen/*` bind to
      the same data the in-game garage UI shows, so they are more likely than SHM or the
      `.svm` to expose UI-accurate current aid indices. The `.svm` stores only *indices*, not
      reconstructable UI values (see S4.2), so it is a weaker fallback. **NEEDS LIVE
      VERIFICATION:** capture `getPlayerGarageData` + `RepairAndRefuel` JSON and grep for
      traction/abs/enginemap/mixture fields (probe step 3). If absent everywhere, advise in
      *relative clicks* only. Sources: TinyPedal; lmu-pitwall; LMU `.svm` format thread.
- [ ] **S4** Setup file location + format for **read-only** parsing (and/or REST setup read).
  - *desk-research (confirmed from public sources — see "S2 / S4 desk-research findings"):*
    **Location:** `…\steamapps\common\Le Mans Ultimate\UserData\player\Settings\<track>\`,
    **extension `.svm`** (rF2 format). **Format:** human-readable **text / INI** — `[SECTION]`
    headers (e.g. `[REARLEFT]`, `[BODYAERO]`) and `Key=<value>//<comment>` entries. **CRITICAL
    caveat:** values are stored as **0-based indices / deltas from default, not physical UI
    numbers**, and base/step live in the car data (not the file), so *you cannot reliably
    reconstruct the UI values (degrees/psi/clicks) from the `.svm` alone* — use it for
    structure/which-index-changed and express advice in **relative clicks**; get absolute
    current values from SHM (brake bias) / REST (garage tree) instead. **REST alternative:**
    `/rest/garage/getPlayerGarageData` likely exposes current setup/aid state more usefully.
    **NEEDS LIVE VERIFICATION:** exact folder nesting on the current build, the real
    section/key names and which map to TC/ABS/brake-bias/engine-map + mechanical/aero, and
    whether REST exposes a cleaner current-setup read (probe step 4). Sources: simracingsetup
    install guide; seralaci setup repo; LMU `.svm` format community thread.
- [x] Multi-class specifics: class names/IDs for Hypercar / LMP2 / GTE-GT3 as reported.
  **LIVE-CONFIRMED 2026-06-14 (53-car grid):** `mVehicleClass` strings are exactly
  **`Hyper`**, **`LMP2`**, **`GT3`** — see "S1 — live confirmation #2". (Not "Hypercar"/"GTE";
  T2.3 maps these literal strings.)
  - *desk-research:* class name is per-vehicle `rF2VehicleScoring.mVehicleClass[32]` (ANSI
    string). Source: `rF2State.h`.
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
