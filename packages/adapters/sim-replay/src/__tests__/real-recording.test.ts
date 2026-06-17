import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  EventDetector,
  RaceStateSchema,
  trafficRule,
  type EngineerEvent,
  type RaceState,
} from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import { parseReplay } from '../replay';

/**
 * Tests against a **real LMU recording** — a trimmed multi-class slice (Hyper/LMP2/GT3) of a recorded
 * Circuit de la Sarthe stint, captured on the rig via `pnpm record` (docs/03 §S1#3). Pruned to the
 * player + the nearest few cars of each class over a 60-frame window centred on a 0.0 m side-by-side, so
 * the strategy/event logic runs against genuine Le Mans telemetry instead of synthetic fixtures (T1.5).
 */
const FIXTURE = fileURLToPath(
  new URL('../../fixtures/lemans-multiclass.replay.jsonl', import.meta.url),
);
const loadFixture = async (): Promise<RaceState[]> => parseReplay(await readFile(FIXTURE, 'utf8'));

describe('real LMU recording fixture (Le Mans multi-class)', () => {
  it('every frame is schema-valid canonical RaceState', async () => {
    const frames = await loadFixture();
    expect(frames.length).toBeGreaterThan(40);
    for (const f of frames) expect(() => RaceStateSchema.parse(f)).not.toThrow();
  });

  it('is genuinely multi-class (Hyper / LMP2 / GT3 all present)', async () => {
    const frames = await loadFixture();
    const classes = new Set(frames.flatMap((f) => f.cars.map((c) => c.className)));
    expect(classes.has('Hyper')).toBe(true);
    expect(classes.has('LMP2')).toBe(true);
    expect(classes.has('GT3')).toBe(true);
  });

  // The player here is a GT3 — the slowest class in the field (Hyper ~218 s, LMP2 ~226 s, GT3 ~255 s).
  // The live-rig bug was hearing "slower class ahead" for a GT3; with class-rank gating it must never
  // fire, and any "faster class approaching" must target a genuinely faster (Hyper/LMP2) car.
  it('never raises slower_class_ahead for a GT3, and only flags genuinely faster classes', async () => {
    const frames = await loadFixture();
    expect(frames[0]?.player.className).toBe('GT3'); // guard: the fixture is the GT3 capture
    const detector = new EventDetector([trafficRule()]);
    const events: EngineerEvent[] = [];
    for (const frame of frames) events.push(...detector.process(frame));

    expect(events.filter((e) => e.type === 'slower_class_ahead')).toHaveLength(0);
    for (const e of events.filter((e) => e.type === 'faster_class_approaching')) {
      expect(['Hyper', 'LMP2']).toContain(e.payload.className); // never a same/slower class
    }
  });
});
