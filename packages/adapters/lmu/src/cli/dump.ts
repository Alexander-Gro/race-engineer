import { openShmReader } from '../shm/reader';
import { KELVIN } from '../shm/structs';
import type { RawVehicleTelemetry, RawWheel, ScoringFrame, TelemetryFrame } from '../shm/structs';

/**
 * S1 raw shared-memory dump (build-plan T1.1). Opens the rF2 SMMP buffers read-only and
 * prints key fuel/tire/position fields so the user can confirm, on the live rig, that the
 * plugin works and the struct layout matches the current LMU build.
 *
 * Windows-only (requires LMU running with the plugin enabled). Run: `pnpm shm-dump`.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Flags {
  frames: number;
  hz: number;
}

const parseFlags = (args: string[]): Flags => {
  const flags: Flags = { frames: 10, hz: 2 };
  for (let i = 0; i < args.length; i += 1) {
    const next = args[i + 1] ?? '';
    if (args[i] === '--frames') {
      flags.frames = Math.max(1, Number.parseInt(next, 10) || flags.frames);
      i += 1;
    } else if (args[i] === '--hz') {
      flags.hz = Math.max(1, Number.parseInt(next, 10) || flags.hz);
      i += 1;
    }
  }
  return flags;
};

const toC = (kelvin: number): string => (kelvin - KELVIN).toFixed(0);

const wheelLine = (label: string, w: RawWheel): string =>
  `     ${label} temp=${toC(w.tempK[0])}/${toC(w.tempK[1])}/${toC(w.tempK[2])}°C` +
  `  press=${w.pressureKpa.toFixed(0)}kPa  wear=${w.wear.toFixed(2)}  brake=${toC(w.brakeTempK)}°C`;

const printPlayerTelemetry = (tel: RawVehicleTelemetry): void => {
  console.log(
    `     fuel=${tel.fuel.toFixed(1)}/${tel.fuelCapacity.toFixed(0)}L  rpm=${tel.engineRPM.toFixed(0)}/${tel.engineMaxRPM.toFixed(0)}` +
      `  gear=${tel.gear}  speed=${(tel.speedMps * 3.6).toFixed(0)}kph  brakeBias=${(tel.rearBrakeBias * 100).toFixed(1)}%  water=${tel.waterTempC.toFixed(0)}°C`,
  );
  console.log(wheelLine('FL', tel.wheels[0]));
  console.log(wheelLine('FR', tel.wheels[1]));
  console.log(wheelLine('RL', tel.wheels[2]));
  console.log(wheelLine('RR', tel.wheels[3]));
  if (tel.frontTireCompound || tel.rearTireCompound) {
    console.log(`     compound: front=${tel.frontTireCompound} rear=${tel.rearTireCompound}`);
  }
};

const printFrame = (telemetry: TelemetryFrame | null, scoring: ScoringFrame | null): void => {
  if (!scoring) {
    console.log('  (no scoring frame this tick)');
    return;
  }
  const { info } = scoring;
  console.log(
    `# ${info.trackName || '(track?)'}  ET=${info.currentET.toFixed(0)}s  cars=${info.numVehicles}` +
      `  trackLen=${info.trackLengthM.toFixed(0)}m  air=${info.ambientTempC.toFixed(0)}°C track=${info.trackTempC.toFixed(0)}°C`,
  );
  const player = scoring.vehicles.find((v) => v.isPlayer);
  if (!player) {
    console.log('  (no player vehicle in scoring yet)');
    return;
  }
  console.log(
    `  P${player.place} ${player.driverName || '(you)'} [${player.vehicleClass || '?'}]` +
      `  lap=${player.totalLaps}  last=${player.lastLapTime.toFixed(3)}s best=${player.bestLapTime.toFixed(3)}s` +
      `  pit=${player.inPits ? 'Y' : 'N'} stops=${player.numPitstops}`,
  );
  const tel = telemetry?.vehicles.find((v) => v.id === player.id);
  if (tel) {
    printPlayerTelemetry(tel);
  } else {
    console.log('     (no matching telemetry vehicle for player id)');
  }
};

const main = async (): Promise<void> => {
  const flags = parseFlags(process.argv.slice(2));
  const reader = openShmReader();

  if (!reader.available.telemetry && !reader.available.scoring) {
    console.error(
      'LMU shared memory not found. Is LMU running and the rF2 Shared Memory Map plugin ' +
        'installed + enabled? See docs/03 §S1 for install/enable steps.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `# shared memory: telemetry=${reader.available.telemetry} scoring=${reader.available.scoring} ` +
      `(${flags.frames} frames @ ${flags.hz}Hz)`,
  );
  try {
    for (let i = 0; i < flags.frames; i += 1) {
      printFrame(reader.readTelemetry(), reader.readScoring());
      if (i < flags.frames - 1) await sleep(1000 / flags.hz);
    }
  } finally {
    reader.close();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
