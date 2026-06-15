import { ASK_FALLBACK, FakeProvider } from '@race-engineer/ai';
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

describe('AskResponder (free template mode)', () => {
  it('guides the driver until the first snapshot arrives (no null-context read)', async () => {
    expect(await new AskResponder().answer("how's my fuel?")).toBe(NO_TELEMETRY_ANSWER);
  });

  it('answers from the latest snapshot, quoting the strategy numbers verbatim', async () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    const a = await responder.answer("how's my fuel?");
    expect(a).toMatch(/8 laps of fuel left/);
    expect(a).toContain(fuelPlan!.perLapLiters.toFixed(2));
  });

  it('answers against the freshest snapshot, not the one at first update', async () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    responder.update({ seq: 4, monotonicMs: 13_000, raceState: multiClassTrafficState });
    // Latest snapshot has no fuel plan → the honest "still learning" answer, not the stale one.
    expect(await responder.answer('fuel?')).toMatch(/[Ss]till learning/);
  });

  it('falls back gracefully for an unrecognised question', async () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    expect(await responder.answer('tell me a joke')).toBe(ASK_FALLBACK);
  });
});

describe('AskResponder (configured LLM engineer)', () => {
  it('routes through the LLM and speaks its answer when every number is grounded in a tool result', async () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    responder.setProvider(
      new FakeProvider([
        { tools: [{ name: 'get_fuel_plan' }] },
        {
          text: (r) => {
            const plan = r.get_fuel_plan as { lapsRemainingOnFuel: number };
            return `You've got ${plan.lapsRemainingOnFuel.toFixed(1)} laps in the tank.`;
          },
        },
      ]),
    );
    const a = await responder.answer("how's my fuel?");
    expect(a).toContain(fuelPlan!.lapsRemainingOnFuel.toFixed(1));
  });

  it('rejects an ungrounded LLM number and falls back to the grounded template answer', async () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    // No tool call, but the reply states a figure → ungrounded → must not be spoken.
    responder.setProvider(new FakeProvider([{ text: 'You are running P3, two seconds clear.' }]));
    const a = await responder.answer('what position am I in?');
    expect(a).not.toContain('two seconds');
    expect(a).toMatch(/P8/); // the template answer from the fixture (grounded)
  });

  it('falls back to template mode when the provider throws (never leaves the driver hanging)', async () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    responder.setProvider({
      name: 'boom',
      complete: () => Promise.reject(new Error('network down')),
    });
    expect(await responder.answer("how's my fuel?")).toMatch(/8 laps of fuel left/);
  });

  it('setProvider(null) returns to free template mode', async () => {
    const responder = new AskResponder();
    responder.update(snapshot);
    responder.setProvider(new FakeProvider([{ text: 'ignored' }]));
    responder.setProvider(null);
    expect(await responder.answer("how's my fuel?")).toMatch(/8 laps of fuel left/);
  });
});
