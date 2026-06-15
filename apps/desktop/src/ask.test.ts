import { ASK_FALLBACK } from '@race-engineer/ai';
import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import { AskResponder, NO_TELEMETRY_ANSWER, snapshotToRaceContext } from './ask';

const fuelPlan = computeFuelPlan({
  fuelLiters: 20,
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
  race: { remainingS: 3600, avgGreenLapS: 200 },
});

const snapshot: EngineerSnapshot = {
  seq: 3,
  monotonicMs: 12_000,
  raceState: multiClassTrafficState,
  strategy: { fuelPlan, stintPlan: null },
};

describe('snapshotToRaceContext', () => {
  it('maps the race state and the live strategy plans onto the AI context', () => {
    const ctx = snapshotToRaceContext(snapshot);
    expect(ctx.raceState).toBe(multiClassTrafficState);
    expect(ctx.fuelPlan).toBe(fuelPlan);
    expect(ctx.stintPlan).toBeNull();
  });

  it('defaults missing strategy to nulls so a snapshot without it is still answerable', () => {
    const ctx = snapshotToRaceContext({
      seq: 0,
      monotonicMs: 0,
      raceState: multiClassTrafficState,
    });
    expect(ctx.fuelPlan).toBeNull();
    expect(ctx.stintPlan).toBeNull();
  });
});

describe('AskResponder', () => {
  it('guides the driver until the first snapshot arrives (no null-context read)', () => {
    expect(new AskResponder().answer("how's my fuel?")).toBe(NO_TELEMETRY_ANSWER);
  });

  it('answers from the latest snapshot, quoting the strategy numbers verbatim', () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    const a = responder.answer("how's my fuel?");
    expect(a).toMatch(/8 laps of fuel left/);
    expect(a).toContain(fuelPlan!.perLapLiters.toFixed(2));
  });

  it('answers against the freshest snapshot, not the one at first update', () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    responder.update({ seq: 4, monotonicMs: 13_000, raceState: multiClassTrafficState });
    // Latest snapshot has no fuel plan → the honest "still learning" answer, not the stale one.
    expect(responder.answer('fuel?')).toMatch(/[Ss]till learning/);
  });

  it('falls back gracefully for an unrecognised question', () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    expect(responder.answer('tell me a joke')).toBe(ASK_FALLBACK);
  });
});
