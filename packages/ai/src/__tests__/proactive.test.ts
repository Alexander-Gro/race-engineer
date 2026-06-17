import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import type { EngineerEvent } from '@race-engineer/core';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import type { RaceContext } from '../context';
import { FakeProvider, PROACTIVE_SILENT, runProactiveTurn } from '../index';
import type { CompletionRequest, LlmProvider, ProviderResponse } from '../types';

const fuelPlan = computeFuelPlan({
  fuelLiters: 38,
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
});
const ctx: RaceContext = { raceState: multiClassTrafficState, fuelPlan };

const event = (
  type: EngineerEvent['type'],
  payload: Record<string, unknown> = {},
): EngineerEvent => ({
  id: 'e1',
  tick: 0,
  type,
  tier: 1,
  priority: 5,
  payload,
});

describe('runProactiveTurn', () => {
  it('reasons over live data via tools and speaks a call quoting the tool number', async () => {
    const provider = new FakeProvider([
      { tools: [{ name: 'get_tire_status' }] },
      { text: () => 'Tyres are in the window now — lean on them.' },
    ]);

    const result = await runProactiveTurn({
      provider,
      context: () => ctx,
      event: event('tire_temp_recovered', { window: { minC: 80, maxC: 100 } }),
    });

    expect(result.toolCalls.map((c) => c.name)).toEqual(['get_tire_status']);
    expect(result.text).toBe('Tyres are in the window now — lean on them.');
  });

  it('returns null when the engineer judges the moment not worth a word (SILENT)', async () => {
    const provider = new FakeProvider([{ text: PROACTIVE_SILENT }]);
    const result = await runProactiveTurn({
      provider,
      context: () => ctx,
      event: event('tire_temp_out_of_window', { direction: 'cold' }),
    });
    expect(result.text).toBeNull();
  });

  it('treats a punctuated/cased SILENT and an empty reply as silence', async () => {
    for (const text of ['Silent.', 'silent', '   ']) {
      const provider = new FakeProvider([{ text }]);
      const r = await runProactiveTurn({
        provider,
        context: () => ctx,
        event: event('tire_temp_out_of_window', { direction: 'cold' }),
      });
      expect(r.text).toBeNull();
    }
  });

  it('flags an ungrounded number — a spoken figure with no source in any tool result', async () => {
    const provider = new FakeProvider([
      { tools: [{ name: 'get_fuel_plan' }] },
      { text: '[calm] Fuel good for 999 laps.' }, // 999 is invented — not in the fuel plan
    ]);
    const r = await runProactiveTurn({ provider, context: () => ctx, event: event('fuel_low') });
    expect(r.hallucination.grounded).toBe(false);
    expect(r.hallucination.ungrounded.map((u) => u.text)).toContain('999');
  });

  it('is grounded when the spoken number traces to a tool result', async () => {
    const provider = new FakeProvider([
      { tools: [{ name: 'get_fuel_plan' }] },
      {
        text: (results) => {
          const plan = results.get_fuel_plan as { lapsRemainingOnFuel: number };
          return `[calm] Fuel's good — ${plan.lapsRemainingOnFuel.toFixed(1)} laps.`;
        },
      },
    ]);
    const r = await runProactiveTurn({ provider, context: () => ctx, event: event('fuel_low') });
    expect(r.hallucination.grounded).toBe(true);
  });

  it('forwards prior call-outs as history (so the engineer can avoid repeating itself)', async () => {
    let seen: CompletionRequest | null = null;
    const capture: LlmProvider = {
      name: 'capture',
      complete: (req): Promise<ProviderResponse> => {
        seen = req;
        return Promise.resolve({ text: PROACTIVE_SILENT, toolCalls: [] });
      },
    };
    await runProactiveTurn({
      provider: capture,
      context: () => ctx,
      event: event('fuel_low'),
      history: [
        { role: 'user', content: 'Monitor flagged: fuel_low.' },
        { role: 'assistant', content: "Fuel's tight, save a tenth." },
      ],
    });
    expect(seen!.messages.some((m) => m.content === "Fuel's tight, save a tenth.")).toBe(true);
  });

  it('frames the trigger as a flagged candidate, not a script, and carries the proactive prompt', async () => {
    let seen: CompletionRequest | null = null;
    const capture: LlmProvider = {
      name: 'capture',
      complete: (req): Promise<ProviderResponse> => {
        seen = req;
        return Promise.resolve({ text: PROACTIVE_SILENT, toolCalls: [] });
      },
    };
    await runProactiveTurn({
      provider: capture,
      context: () => ctx,
      event: event('tire_temp_out_of_window', { direction: 'cold' }),
    });
    // System prompt inherits the engineer playbook + the proactive "you decide" framing.
    expect(seen!.system).toContain('race engineer');
    expect(seen!.system).toContain(PROACTIVE_SILENT);
    // The trigger reaches the model as a flagged signal, not pre-written words.
    const user = seen!.messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('Monitor flagged: tire_temp_out_of_window');
  });
});
