import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseReplay, serializeReplay } from '../replay';
import { readReplayFile, writeReplayFile } from '../replay-file';
import { scriptedScenario, synthesizeFrames } from '../synthetic';

describe('replay (de)serialization', () => {
  it('round-trips frames through JSON Lines in memory', () => {
    const frames = synthesizeFrames(scriptedScenario());
    expect(parseReplay(serializeReplay(frames))).toEqual(frames);
  });

  it('rejects a corrupt replay line', () => {
    expect(() => parseReplay('{"not":"a real frame"}\n')).toThrow();
  });

  it('replays a recorded file from disk as a deterministic stream', async () => {
    const frames = synthesizeFrames(scriptedScenario());
    const dir = await mkdtemp(join(tmpdir(), 'race-engineer-replay-'));
    const file = join(dir, 'scenario.replay.jsonl');
    try {
      await writeReplayFile(file, frames);
      expect(await readReplayFile(file)).toEqual(frames);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
