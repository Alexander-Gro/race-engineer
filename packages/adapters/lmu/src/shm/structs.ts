import {
  chars,
  f32,
  f64,
  fieldOf,
  i16,
  i32,
  i8,
  layoutStruct,
  offsetOf,
  struct,
  u16,
  u32,
  u8,
  type StructLayout,
} from './layout';

/**
 * rF2 shared-memory struct layouts and field readers, transcribed verbatim from the
 * source-verified field lists in docs/03 §S1 (`TheIronWolfModding/rF2SharedMemoryMapPlugin`
 * `rF2State.h`, mirrored by `pyRfactor2SharedMemory`). All structs are `pack(4)`.
 *
 * Decoders are pure (operate on a `Buffer`) and faithful to the raw struct — units are NOT
 * converted here (temps stay Kelvin, etc.); presentation/normalization converts. The byte
 * layout is unit-tested via round-trip; the live dump confirms it matches the actual game.
 */

export const KELVIN = 273.15;

/** Memory-mapped file names we open (read-only). Write/control buffers are never opened. */
export const MMF = {
  telemetry: '$rFactor2SMMP_Telemetry$',
  scoring: '$rFactor2SMMP_Scoring$',
  extended: '$rFactor2SMMP_Extended$',
  rules: '$rFactor2SMMP_Rules$',
} as const;

export const MAX_MAPPED_VEHICLES = 128;

// --- Layouts (declaration order is byte-offset-significant) ---------------------------

const vec3 = layoutStruct([f64('x'), f64('y'), f64('z')]);

export const wheelLayout: StructLayout = layoutStruct([
  f64('mSuspensionDeflection'),
  f64('mRideHeight'),
  f64('mSuspForce'),
  f64('mBrakeTemp'),
  f64('mBrakePressure'),
  f64('mRotation'),
  f64('mLateralPatchVel'),
  f64('mLongitudinalPatchVel'),
  f64('mLateralGroundVel'),
  f64('mLongitudinalGroundVel'),
  f64('mCamber'),
  f64('mLateralForce'),
  f64('mLongitudinalForce'),
  f64('mTireLoad'),
  f64('mGripFract'),
  f64('mPressure'),
  f64('mTemperature', 3),
  f64('mWear'),
  chars('mTerrainName', 16),
  u8('mSurfaceType'),
  u8('mFlat'),
  u8('mDetached'),
  u8('mStaticUndeflectedRadius'),
  f64('mVerticalTireDeflection'),
  f64('mWheelYLocation'),
  f64('mToe'),
  f64('mTireCarcassTemperature'),
  f64('mTireInnerLayerTemperature', 3),
  u8('mExpansion', 24),
]);

export const vehicleTelemetryLayout: StructLayout = layoutStruct([
  i32('mID'),
  f64('mDeltaTime'),
  f64('mElapsedTime'),
  i32('mLapNumber'),
  f64('mLapStartET'),
  chars('mVehicleName', 64),
  chars('mTrackName', 64),
  struct('mPos', vec3),
  struct('mLocalVel', vec3),
  struct('mLocalAccel', vec3),
  struct('mOri', vec3, 3),
  struct('mLocalRot', vec3),
  struct('mLocalRotAccel', vec3),
  i32('mGear'),
  f64('mEngineRPM'),
  f64('mEngineWaterTemp'),
  f64('mEngineOilTemp'),
  f64('mClutchRPM'),
  f64('mUnfilteredThrottle'),
  f64('mUnfilteredBrake'),
  f64('mUnfilteredSteering'),
  f64('mUnfilteredClutch'),
  f64('mFilteredThrottle'),
  f64('mFilteredBrake'),
  f64('mFilteredSteering'),
  f64('mFilteredClutch'),
  f64('mSteeringShaftTorque'),
  f64('mFront3rdDeflection'),
  f64('mRear3rdDeflection'),
  f64('mFrontWingHeight'),
  f64('mFrontRideHeight'),
  f64('mRearRideHeight'),
  f64('mDrag'),
  f64('mFrontDownforce'),
  f64('mRearDownforce'),
  f64('mFuel'),
  f64('mEngineMaxRPM'),
  u8('mScheduledStops'),
  u8('mOverheating'),
  u8('mDetached'),
  u8('mHeadlights'),
  u8('mDentSeverity', 8),
  f64('mLastImpactET'),
  f64('mLastImpactMagnitude'),
  struct('mLastImpactPos', vec3),
  f64('mEngineTorque'),
  i32('mCurrentSector'),
  u8('mSpeedLimiter'),
  u8('mMaxGears'),
  u8('mFrontTireCompoundIndex'),
  u8('mRearTireCompoundIndex'),
  f64('mFuelCapacity'),
  u8('mFrontFlapActivated'),
  u8('mRearFlapActivated'),
  u8('mRearFlapLegalStatus'),
  u8('mIgnitionStarter'),
  chars('mFrontTireCompoundName', 18),
  chars('mRearTireCompoundName', 18),
  u8('mSpeedLimiterAvailable'),
  u8('mAntiStallActivated'),
  u8('mUnused', 2),
  f32('mVisualSteeringWheelRange'),
  f64('mRearBrakeBias'),
  f64('mTurboBoostPressure'),
  f32('mPhysicsToGraphicsOffset', 3),
  f32('mPhysicalSteeringWheelRange'),
  f64('mBatteryChargeFraction'),
  f64('mElectricBoostMotorTorque'),
  f64('mElectricBoostMotorRPM'),
  f64('mElectricBoostMotorTemperature'),
  f64('mElectricBoostWaterTemperature'),
  u8('mElectricBoostMotorState'),
  u8('mExpansion', 111),
  struct('mWheels', wheelLayout, 4),
]);

export const telemetryLayout: StructLayout = layoutStruct([
  u32('mVersionUpdateBegin'),
  u32('mVersionUpdateEnd'),
  i32('mBytesUpdatedHint'),
  i32('mNumVehicles'),
  struct('mVehicles', vehicleTelemetryLayout, MAX_MAPPED_VEHICLES),
]);

export const scoringInfoLayout: StructLayout = layoutStruct([
  chars('mTrackName', 64),
  i32('mSession'),
  f64('mCurrentET'),
  f64('mEndET'),
  i32('mMaxLaps'),
  f64('mLapDist'),
  u8('pointer1', 8),
  i32('mNumVehicles'),
  u8('mGamePhase'),
  i8('mYellowFlagState'),
  i8('mSectorFlag', 3),
  u8('mStartLight'),
  u8('mNumRedLights'),
  u8('mInRealtime'),
  chars('mPlayerName', 32),
  chars('mPlrFileName', 64),
  f64('mDarkCloud'),
  f64('mRaining'),
  f64('mAmbientTemp'),
  f64('mTrackTemp'),
  struct('mWind', vec3),
  f64('mMinPathWetness'),
  f64('mMaxPathWetness'),
  u8('mGameMode'),
  u8('mIsPasswordProtected'),
  u16('mServerPort'),
  u32('mServerPublicIP'),
  i32('mMaxPlayers'),
  chars('mServerName', 32),
  f32('mStartET'),
  f64('mAvgPathWetness'),
  u8('mExpansion', 200),
  u8('pointer2', 8),
]);

export const vehicleScoringLayout: StructLayout = layoutStruct([
  i32('mID'),
  chars('mDriverName', 32),
  chars('mVehicleName', 64),
  i16('mTotalLaps'),
  i8('mSector'),
  i8('mFinishStatus'),
  f64('mLapDist'),
  f64('mPathLateral'),
  f64('mTrackEdge'),
  f64('mBestSector1'),
  f64('mBestSector2'),
  f64('mBestLapTime'),
  f64('mLastSector1'),
  f64('mLastSector2'),
  f64('mLastLapTime'),
  f64('mCurSector1'),
  f64('mCurSector2'),
  i16('mNumPitstops'),
  i16('mNumPenalties'),
  u8('mIsPlayer'),
  i8('mControl'),
  u8('mInPits'),
  u8('mPlace'),
  chars('mVehicleClass', 32),
  f64('mTimeBehindNext'),
  i32('mLapsBehindNext'),
  f64('mTimeBehindLeader'),
  i32('mLapsBehindLeader'),
  f64('mLapStartET'),
  struct('mPos', vec3),
  struct('mLocalVel', vec3),
  struct('mLocalAccel', vec3),
  struct('mOri', vec3, 3),
  struct('mLocalRot', vec3),
  struct('mLocalRotAccel', vec3),
  u8('mHeadlights'),
  u8('mPitState'),
  u8('mServerScored'),
  u8('mIndividualPhase'),
  i32('mQualification'),
  f64('mTimeIntoLap'),
  f64('mEstimatedLapTime'),
  chars('mPitGroup', 24),
  u8('mFlag'),
  u8('mUnderYellow'),
  u8('mCountLapFlag'),
  u8('mInGarageStall'),
  u8('mUpgradePack', 16),
  f32('mPitLapDist'),
  f32('mBestLapSector1'),
  f32('mBestLapSector2'),
  u8('mExpansion', 48),
]);

export const scoringLayout: StructLayout = layoutStruct([
  u32('mVersionUpdateBegin'),
  u32('mVersionUpdateEnd'),
  i32('mBytesUpdatedHint'),
  struct('mScoringInfo', scoringInfoLayout),
  struct('mVehicles', vehicleScoringLayout, MAX_MAPPED_VEHICLES),
]);

export const extendedLayout: StructLayout = layoutStruct([
  u32('mVersionUpdateBegin'),
  u32('mVersionUpdateEnd'),
]);

// --- Buffer read helpers --------------------------------------------------------------

const readChars = (b: Buffer, offset: number, length: number): string => {
  const nul = b.indexOf(0, offset);
  const end = nul >= 0 && nul < offset + length ? nul : offset + length;
  return b.toString('latin1', offset, end);
};

const vecMag = (b: Buffer, base: number): number => {
  const x = b.readDoubleLE(base + offsetOf(vec3, 'x'));
  const y = b.readDoubleLE(base + offsetOf(vec3, 'y'));
  const z = b.readDoubleLE(base + offsetOf(vec3, 'z'));
  return Math.sqrt(x * x + y * y + z * z);
};

// --- Decoders -------------------------------------------------------------------------

export interface RawWheel {
  brakeTempK: number;
  pressureKpa: number;
  tempK: [number, number, number];
  wear: number;
}

const readWheel = (b: Buffer, base: number): RawWheel => {
  const t = base + offsetOf(wheelLayout, 'mTemperature');
  return {
    brakeTempK: b.readDoubleLE(base + offsetOf(wheelLayout, 'mBrakeTemp')),
    pressureKpa: b.readDoubleLE(base + offsetOf(wheelLayout, 'mPressure')),
    tempK: [b.readDoubleLE(t), b.readDoubleLE(t + 8), b.readDoubleLE(t + 16)],
    wear: b.readDoubleLE(base + offsetOf(wheelLayout, 'mWear')),
  };
};

export interface RawVehicleTelemetry {
  id: number;
  gear: number;
  engineRPM: number;
  engineMaxRPM: number;
  fuel: number;
  fuelCapacity: number;
  waterTempC: number;
  oilTempC: number;
  rearBrakeBias: number;
  frontTireCompound: string;
  rearTireCompound: string;
  speedMps: number;
  wheels: [RawWheel, RawWheel, RawWheel, RawWheel];
}

const readVehicleTelemetry = (b: Buffer, base: number): RawVehicleTelemetry => {
  const wheels = fieldOf(vehicleTelemetryLayout, 'mWheels');
  const w = base + wheels.offset;
  const ws = wheels.stride;
  const o = (name: string): number => base + offsetOf(vehicleTelemetryLayout, name);
  return {
    id: b.readInt32LE(o('mID')),
    gear: b.readInt32LE(o('mGear')),
    engineRPM: b.readDoubleLE(o('mEngineRPM')),
    engineMaxRPM: b.readDoubleLE(o('mEngineMaxRPM')),
    fuel: b.readDoubleLE(o('mFuel')),
    fuelCapacity: b.readDoubleLE(o('mFuelCapacity')),
    waterTempC: b.readDoubleLE(o('mEngineWaterTemp')),
    oilTempC: b.readDoubleLE(o('mEngineOilTemp')),
    rearBrakeBias: b.readDoubleLE(o('mRearBrakeBias')),
    frontTireCompound: readChars(b, o('mFrontTireCompoundName'), 18),
    rearTireCompound: readChars(b, o('mRearTireCompoundName'), 18),
    speedMps: vecMag(b, o('mLocalVel')),
    wheels: [
      readWheel(b, w),
      readWheel(b, w + ws),
      readWheel(b, w + 2 * ws),
      readWheel(b, w + 3 * ws),
    ],
  };
};

export interface TelemetryFrame {
  numVehicles: number;
  vehicles: RawVehicleTelemetry[];
}

export const readTelemetry = (b: Buffer): TelemetryFrame => {
  const numVehicles = Math.max(
    0,
    Math.min(MAX_MAPPED_VEHICLES, b.readInt32LE(offsetOf(telemetryLayout, 'mNumVehicles'))),
  );
  const vehiclesField = fieldOf(telemetryLayout, 'mVehicles');
  const base = vehiclesField.offset;
  const stride = vehiclesField.stride;
  const vehicles: RawVehicleTelemetry[] = [];
  for (let i = 0; i < numVehicles; i += 1) {
    vehicles.push(readVehicleTelemetry(b, base + i * stride));
  }
  return { numVehicles, vehicles };
};

export interface RawScoringInfo {
  trackName: string;
  session: number;
  currentET: number;
  endET: number;
  maxLaps: number;
  trackLengthM: number;
  numVehicles: number;
  gamePhase: number;
  yellowFlagState: number;
  sectorFlag: [number, number, number];
  ambientTempC: number;
  trackTempC: number;
}

const readScoringInfo = (b: Buffer, base: number): RawScoringInfo => {
  const o = (name: string): number => base + offsetOf(scoringInfoLayout, name);
  const sf = o('mSectorFlag');
  return {
    trackName: readChars(b, o('mTrackName'), 64),
    session: b.readInt32LE(o('mSession')),
    currentET: b.readDoubleLE(o('mCurrentET')),
    endET: b.readDoubleLE(o('mEndET')),
    maxLaps: b.readInt32LE(o('mMaxLaps')),
    trackLengthM: b.readDoubleLE(o('mLapDist')),
    numVehicles: b.readInt32LE(o('mNumVehicles')),
    gamePhase: b.readUInt8(o('mGamePhase')),
    yellowFlagState: b.readInt8(o('mYellowFlagState')),
    sectorFlag: [b.readInt8(sf), b.readInt8(sf + 1), b.readInt8(sf + 2)],
    ambientTempC: b.readDoubleLE(o('mAmbientTemp')),
    trackTempC: b.readDoubleLE(o('mTrackTemp')),
  };
};

export interface RawVehicleScoring {
  id: number;
  place: number;
  isPlayer: boolean;
  driverName: string;
  vehicleClass: string;
  totalLaps: number;
  lapDistM: number;
  /** Signed lateral offset from the track path centerline — confirms the spotter sign (T3.4). */
  pathLateral: number;
  timeBehindNext: number;
  timeBehindLeader: number;
  lapsBehindLeader: number;
  bestLapTime: number;
  lastLapTime: number;
  numPitstops: number;
  inPits: boolean;
  pitState: number;
  underYellow: boolean;
  flag: number;
}

const readVehicleScoring = (b: Buffer, base: number): RawVehicleScoring => {
  const o = (name: string): number => base + offsetOf(vehicleScoringLayout, name);
  return {
    id: b.readInt32LE(o('mID')),
    place: b.readUInt8(o('mPlace')),
    isPlayer: b.readUInt8(o('mIsPlayer')) !== 0,
    driverName: readChars(b, o('mDriverName'), 32),
    vehicleClass: readChars(b, o('mVehicleClass'), 32),
    totalLaps: b.readInt16LE(o('mTotalLaps')),
    lapDistM: b.readDoubleLE(o('mLapDist')),
    pathLateral: b.readDoubleLE(o('mPathLateral')),
    timeBehindNext: b.readDoubleLE(o('mTimeBehindNext')),
    timeBehindLeader: b.readDoubleLE(o('mTimeBehindLeader')),
    lapsBehindLeader: b.readInt32LE(o('mLapsBehindLeader')),
    bestLapTime: b.readDoubleLE(o('mBestLapTime')),
    lastLapTime: b.readDoubleLE(o('mLastLapTime')),
    numPitstops: b.readInt16LE(o('mNumPitstops')),
    inPits: b.readUInt8(o('mInPits')) !== 0,
    pitState: b.readUInt8(o('mPitState')),
    underYellow: b.readUInt8(o('mUnderYellow')) !== 0,
    flag: b.readUInt8(o('mFlag')),
  };
};

export interface ScoringFrame {
  info: RawScoringInfo;
  vehicles: RawVehicleScoring[];
}

export const readScoring = (b: Buffer): ScoringFrame => {
  const info = readScoringInfo(b, offsetOf(scoringLayout, 'mScoringInfo'));
  const count = Math.max(0, Math.min(MAX_MAPPED_VEHICLES, info.numVehicles));
  const vehiclesField = fieldOf(scoringLayout, 'mVehicles');
  const base = vehiclesField.offset;
  const stride = vehiclesField.stride;
  const vehicles: RawVehicleScoring[] = [];
  for (let i = 0; i < count; i += 1) {
    vehicles.push(readVehicleScoring(b, base + i * stride));
  }
  return { info, vehicles };
};
