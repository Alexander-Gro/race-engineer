import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseReplay } from '../replay';
import { readReplayFile } from '../replay-file';
import { Recorder } from '../recorder';
import { scriptedScenario, synthesizeFrames } from '../synthetic';

describe('Recorder', () => {
  it('captures frames that round-trip exactly through the replay format', () => {
    const frames = synthesizeFrames(scriptedScenario());
    const recorder = new Recorder();
    for (const f of frames) recorder.add(f);

    expect(recorder.count).toBe(frames.length);
    expect(parseReplay(recorder.serialize())).toEqual(frames);
    expect(recorder.truncated).toBe(false);
  });

  it('caps at maxFrames and flags truncation', () => {
    const frames = synthesizeFrames(scriptedScenario());
    const recorder = new Recorder({ maxFrames: 5 });
    for (const f of frames) recorder.add(f);

    expect(recorder.count).toBe(5);
    expect(recorder.truncated).toBe(true);
    expect(recorder.frames).toEqual(frames.slice(0, 5));
  });

  it('record → save → replay-file read round-trips identically', async () => {
    const frames = synthesizeFrames(scriptedScenario());
    const recorder = new Recorder();
    for (const f of frames) recorder.add(f);

    const dir = mkdtempSync(join(tmpdir(), 'race-eng-rec-'));
    const file = join(dir, 'session.jsonl');
    try {
      await recorder.save(file);
      expect(await readReplayFile(file)).toEqual(frames);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
