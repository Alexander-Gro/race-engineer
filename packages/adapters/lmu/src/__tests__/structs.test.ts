import { describe, expect, it } from 'vitest';
import { offsetOf } from '../shm/layout';
import {
  KELVIN,
  readScoring,
  readTelemetry,
  scoringInfoLayout,
  scoringLayout,
  telemetryLayout,
  vehicleScoringLayout,
  vehicleTelemetryLayout,
  wheelLayout,
} from '../shm/structs';

const at = <T>(arr: readonly T[], i: number): T => {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
};

describe('telemetry round-trip (writer offsets == reader offsets)', () => {
  it('decodes a synthetic single-vehicle telemetry buffer', () => {
    const buf = Buffer.alloc(telemetryLayout.size);
    buf.writeUInt32LE(7, offsetOf(telemetryLayout, 'mVersionUpdateBegin'));
    buf.writeUInt32LE(7, offsetOf(telemetryLayout, 'mVersionUpdateEnd'));
    buf.writeInt32LE(1, offsetOf(telemetryLayout, 'mNumVehicles'));

    const v0 = offsetOf(telemetryLayout, 'mVehicles');
    const vt = (name: string): number => v0 + offsetOf(vehicleTelemetryLayout, name);
    buf.writeInt32LE(42, vt('mID'));
    buf.writeInt32LE(4, vt('mGear'));
    buf.writeDoubleLE(8500, vt('mEngineRPM'));
    buf.writeDoubleLE(9000, vt('mEngineMaxRPM'));
    buf.writeDoubleLE(42.5, vt('mFuel'));
    buf.writeDoubleLE(80, vt('mFuelCapacity'));
    buf.writeDoubleLE(0.545, vt('mRearBrakeBias'));
    buf.writeDoubleLE(95, vt('mEngineWaterTemp'));
    buf.writeDoubleLE(50, vt('mLocalVel')); // x; y,z=0 -> speed 50 m/s
    buf.write('soft', vt('mFrontTireCompoundName'), 'latin1');

    // FL wheel
    const w0 = v0 + offsetOf(vehicleTelemetryLayout, 'mWheels');
    const wh = (name: string): number => w0 + offsetOf(wheelLayout, name);
    const tBase = wh('mTemperature');
    buf.writeDoubleLE(KELVIN + 90, tBase);
    buf.writeDoubleLE(KELVIN + 88, tBase + 8);
    buf.writeDoubleLE(KELVIN + 86, tBase + 16);
    buf.writeDoubleLE(180, wh('mPressure'));
    buf.writeDoubleLE(0.95, wh('mWear'));
    buf.writeDoubleLE(KELVIN + 350, wh('mBrakeTemp'));

    const frame = readTelemetry(buf);
    expect(frame.numVehicles).toBe(1);
    const veh = at(frame.vehicles, 0);
    expect(veh.id).toBe(42);
    expect(veh.gear).toBe(4);
    expect(veh.engineRPM).toBeCloseTo(8500);
    expect(veh.engineMaxRPM).toBeCloseTo(9000);
    expect(veh.fuel).toBeCloseTo(42.5);
    expect(veh.fuelCapacity).toBeCloseTo(80);
    expect(veh.rearBrakeBias).toBeCloseTo(0.545);
    expect(veh.waterTempC).toBeCloseTo(95);
    expect(veh.speedMps).toBeCloseTo(50);
    expect(veh.frontTireCompound).toBe('soft');

    const fl = veh.wheels[0];
    expect(fl.pressureKpa).toBeCloseTo(180);
    expect(fl.wear).toBeCloseTo(0.95);
    expect(fl.tempK[0] - KELVIN).toBeCloseTo(90);
    expect(fl.tempK[2] - KELVIN).toBeCloseTo(86);
    expect(fl.brakeTempK - KELVIN).toBeCloseTo(350);
  });
});

describe('scoring round-trip', () => {
  it('decodes a synthetic single-vehicle scoring buffer', () => {
    const buf = Buffer.alloc(scoringLayout.size);
    buf.writeUInt32LE(3, offsetOf(scoringLayout, 'mVersionUpdateBegin'));
    buf.writeUInt32LE(3, offsetOf(scoringLayout, 'mVersionUpdateEnd'));

    const infoBase = offsetOf(scoringLayout, 'mScoringInfo');
    const si = (name: string): number => infoBase + offsetOf(scoringInfoLayout, name);
    buf.write('Le Mans', si('mTrackName'), 'latin1');
    buf.writeDoubleLE(13626, si('mLapDist'));
    buf.writeInt32LE(1, si('mNumVehicles'));
    buf.writeDoubleLE(1234, si('mCurrentET'));
    buf.writeDoubleLE(22, si('mAmbientTemp'));

    const vBase = offsetOf(scoringLayout, 'mVehicles');
    const vs = (name: string): number => vBase + offsetOf(vehicleScoringLayout, name);
    buf.writeInt32LE(42, vs('mID'));
    buf.writeUInt8(1, vs('mIsPlayer'));
    buf.writeUInt8(3, vs('mPlace'));
    buf.write('You', vs('mDriverName'), 'latin1');
    buf.write('Hypercar', vs('mVehicleClass'), 'latin1');
    buf.writeInt16LE(12, vs('mTotalLaps'));
    buf.writeDoubleLE(5200, vs('mLapDist'));
    buf.writeDoubleLE(204.123, vs('mLastLapTime'));

    const frame = readScoring(buf);
    expect(frame.info.trackName).toBe('Le Mans');
    expect(frame.info.trackLengthM).toBeCloseTo(13626);
    expect(frame.info.numVehicles).toBe(1);
    expect(frame.info.currentET).toBeCloseTo(1234);
    expect(frame.info.ambientTempC).toBeCloseTo(22);

    const v = at(frame.vehicles, 0);
    expect(v.id).toBe(42);
    expect(v.isPlayer).toBe(true);
    expect(v.place).toBe(3);
    expect(v.driverName).toBe('You');
    expect(v.vehicleClass).toBe('Hypercar');
    expect(v.totalLaps).toBe(12);
    expect(v.lapDistM).toBeCloseTo(5200);
    expect(v.lastLapTime).toBeCloseTo(204.123);
  });

  // S1#4 (docs/03): the plugin emits name strings as UTF-8, so accented driver names must
  // round-trip intact. A latin1 decode corrupts every multi-byte char (`é` → `Ã©`).
  it('decodes UTF-8 driver names (accents) without corruption', () => {
    const buf = Buffer.alloc(scoringLayout.size);
    const si = (name: string): number =>
      offsetOf(scoringLayout, 'mScoringInfo') + offsetOf(scoringInfoLayout, name);
    buf.writeInt32LE(1, si('mNumVehicles'));
    const vBase = offsetOf(scoringLayout, 'mVehicles');
    const vs = (name: string): number => vBase + offsetOf(vehicleScoringLayout, name);
    buf.write('Sébastien Buemi', vs('mDriverName'), 'utf8');

    const v = at(readScoring(buf).vehicles, 0);
    expect(v.driverName).toBe('Sébastien Buemi');
  });
});
