import {
  MMF,
  readScoring,
  readTelemetry,
  scoringLayout,
  telemetryLayout,
  type ScoringFrame,
  type TelemetryFrame,
} from './structs';
import { readWithTornGuard } from './torn-read';
import { openMappedFile, type MappedBuffer } from './win32';

/**
 * Read-only reader over the rF2 shared-memory buffers: opens the Telemetry and Scoring maps
 * and returns torn-read-guarded canonical-free decodes. Windows-only (uses win32/koffi).
 * This is the S1 dump foundation; the production `GameAdapter` + Normalizer mapping land in
 * T2.1/T2.3.
 */

const readGuarded = <T>(
  buffer: MappedBuffer | null,
  size: number,
  decode: (b: Buffer) => T,
): T | null => {
  if (!buffer) return null;
  const stable = readWithTornGuard({
    readVersion: () => buffer.readVersion(),
    copyBuffer: () => buffer.read(size),
  });
  return stable ? decode(stable.value) : null;
};

export interface ShmReader {
  available: { telemetry: boolean; scoring: boolean };
  readTelemetry: () => TelemetryFrame | null;
  readScoring: () => ScoringFrame | null;
  close: () => void;
}

/** Open the shared-memory maps. Missing maps (game not running) become `available:false`. */
export const openShmReader = (): ShmReader => {
  const telemetry = openMappedFile(MMF.telemetry);
  const scoring = openMappedFile(MMF.scoring);
  return {
    available: { telemetry: telemetry !== null, scoring: scoring !== null },
    readTelemetry: () => readGuarded(telemetry, telemetryLayout.size, readTelemetry),
    readScoring: () => readGuarded(scoring, scoringLayout.size, readScoring),
    close: () => {
      telemetry?.close();
      scoring?.close();
    },
  };
};
