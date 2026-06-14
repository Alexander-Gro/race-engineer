import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import type { RaceContext } from '../context';
import { FakeProvider, runRadioTurn } from '../index';
import type { CompletionRequest, LlmProvider, ProviderResponse } from '../types';

const fuelPlan = computeFuelPlan({
  fuelLiters: 38,
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
});
const ctx: RaceContext = { raceState: multiClassTrafficState, fuelPlan };

describe('runRadioTurn', () => {
  it('runs a tool then quotes the tool number (no invented figures)', async () => {
    const provider = new FakeProvider([
      { tools: [{ name: 'get_fuel_plan' }] },
      {
        text: (results) => {
          const plan = results.get_fuel_plan as { lapsRemainingOnFuel: number };
          return `Fuel's good — ${plan.lapsRemainingOnFuel.toFixed(1)} laps in the tank.`;
        },
      },
    ]);

    const result = await runRadioTurn({
      provider,
      context: () => ctx,
      userMessage: "How's my fuel?",
    });

    expect(result.toolCalls.map((c) => c.name)).toEqual(['get_fuel_plan']);
    const planResult = result.toolCalls[0]?.result as { lapsRemainingOnFuel: number };
    // The spoken number is exactly the tool's number — it didn't come from the model.
    expect(result.text).toContain(planResult.lapsRemainingOnFuel.toFixed(1));
    expect(result.rounds).toBe(2);
  });

  it('answers directly when no tool is needed', async () => {
    const provider = new FakeProvider([{ text: "I don't have that." }]);
    const r = await runRadioTurn({
      provider,
      context: () => ctx,
      userMessage: 'what colour is the sky',
    });
    expect(r.toolCalls).toEqual([]);
    expect(r.text).toBe("I don't have that.");
    expect(r.rounds).toBe(1);
  });

  it('handles multiple tool calls in a single round', async () => {
    const provider = new FakeProvider([
      { tools: [{ name: 'get_rivals' }, { name: 'get_fuel_plan' }] },
      { text: 'ok' },
    ]);
    const r = await runRadioTurn({ provider, context: () => ctx, userMessage: 'sitrep' });
    expect(r.toolCalls.map((c) => c.name)).toEqual(['get_rivals', 'get_fuel_plan']);
  });

  it('records an unknown-tool request as an error without throwing', async () => {
    const provider = new FakeProvider([
      { tools: [{ name: 'get_setup_summary' }] },
      { text: 'done' },
    ]);
    const r = await runRadioTurn({ provider, context: () => ctx, userMessage: 'setup?' });
    expect((r.toolCalls[0]?.result as { error?: string }).error).toMatch(/unknown tool/);
  });

  it('passes the persona system prompt and tool specs to the provider', async () => {
    let seen: CompletionRequest | null = null;
    const capture: LlmProvider = {
      name: 'capture',
      complete: (req): Promise<ProviderResponse> => {
        seen = req;
        return Promise.resolve({ text: 'hi', toolCalls: [] });
      },
    };
    await runRadioTurn({
      provider: capture,
      context: () => ctx,
      userMessage: 'hi',
      persona: 'terse',
    });
    expect(seen!.system).toContain('race engineer');
    expect(seen!.system).toContain('terse');
    expect(seen!.tools.map((t) => t.name)).toContain('get_fuel_plan');
  });
});
