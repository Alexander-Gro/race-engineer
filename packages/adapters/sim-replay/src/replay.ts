import { RaceStateSchema } from '@race-engineer/core';
import type { RaceState } from '@race-engineer/core';

/**
 * Replay file format: JSON Lines — one canonical `RaceState` per line. Frames are validated
 * against the schema on read so a corrupt recording fails loudly instead of poisoning the
 * pipeline.
 */

export const serializeReplay = (frames: RaceState[]): string =>
  frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n';

export const parseReplay = (text: string): RaceState[] => {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    const result = RaceStateSchema.safeParse(JSON.parse(line));
    if (!result.success) {
      throw new Error(`Invalid replay frame on line ${index + 1}: ${result.error.message}`);
    }
    return result.data;
  });
};
