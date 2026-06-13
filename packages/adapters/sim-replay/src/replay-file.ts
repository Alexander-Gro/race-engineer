import { readFile, writeFile } from 'node:fs/promises';
import type { RaceState } from '@race-engineer/core';
import { parseReplay, serializeReplay } from './replay';

/** Read a recorded replay file (JSON Lines) into validated canonical frames. */
export const readReplayFile = async (path: string): Promise<RaceState[]> =>
  parseReplay(await readFile(path, 'utf8'));

/** Write canonical frames to a replay file (JSON Lines). The recorder proper lands in T2.4. */
export const writeReplayFile = async (path: string, frames: RaceState[]): Promise<void> => {
  await writeFile(path, serializeReplay(frames), 'utf8');
};
