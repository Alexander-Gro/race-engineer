import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import type { RaceContext } from '../context';
import { OllamaProvider, runRadioTurn, toToolSpecs } from '../index';
import type { FetchLike } from '../types';

const okJson = (obj: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(obj) });

describe('OllamaProvider', () => {
  it('maps a tool_calls response and builds a correct /api/chat request', async () => {
    const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: FetchLike = (url, init) => {
      captured.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return Promise.resolve(
        okJson({
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'get_fuel_plan', arguments: {} } }],
          },
        }),
      );
    };

    const provider = new OllamaProvider({ fetch: fetchImpl, model: 'qwen3' });
    const res = await provider.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: toToolSpecs(),
    });

    expect(res.toolCalls.map((c) => c.name)).toEqual(['get_fuel_plan']);
    expect(res.text).toBeNull();

    const sent = captured[0]!;
    expect(sent.url).toBe('http://localhost:11434/api/chat');
    expect(sent.body.model).toBe('qwen3');
    expect(sent.body.stream).toBe(false);
    const messages = sent.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: 'system', content: 'sys' });
    const tools = sent.body.tools as Array<{ function: { name: string } }>;
    expect(tools[0]?.function.name).toBe('get_race_state');
  });

  it('disables thinking by default and strips any leaked <think> preamble from the answer', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = (_url, init) => {
      captured.push(JSON.parse(init.body) as Record<string, unknown>);
      return Promise.resolve(
        okJson({
          message: {
            role: 'assistant',
            // qwen3's leak shape with think disabled: a short reasoning preamble, then the real answer.
            content: 'Let me check the tank.\n</think>\n\nFuel: 14.6 laps remaining.',
          },
        }),
      );
    };
    const res = await new OllamaProvider({ fetch: fetchImpl, model: 'qwen3' }).complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'fuel?' }],
      tools: [],
    });
    expect(captured[0]!.think).toBe(false);
    expect(res.text).toBe('Fuel: 14.6 laps remaining.');
  });

  it('can opt back into thinking, and a clean answer passes through untouched', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = (_url, init) => {
      captured.push(JSON.parse(init.body) as Record<string, unknown>);
      return Promise.resolve(okJson({ message: { role: 'assistant', content: 'All good.' } }));
    };
    const res = await new OllamaProvider({ fetch: fetchImpl, think: true }).complete({
      system: '',
      messages: [],
      tools: [],
    });
    expect(captured[0]!.think).toBe(true);
    expect(res.text).toBe('All good.');
  });

  it('parses string-encoded tool arguments', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        okJson({
          message: {
            role: 'assistant',
            tool_calls: [{ function: { name: 'x', arguments: '{"a":1}' } }],
          },
        }),
      );
    const res = await new OllamaProvider({ fetch: fetchImpl }).complete({
      system: '',
      messages: [],
      tools: [],
    });
    expect(res.toolCalls[0]?.args).toEqual({ a: 1 });
  });

  it('throws on a non-OK HTTP status', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    await expect(
      new OllamaProvider({ fetch: fetchImpl }).complete({ system: '', messages: [], tools: [] }),
    ).rejects.toThrow(/500/);
  });

  it('drives a full local radio turn through the orchestrator (tool → answer)', async () => {
    const fuelPlan = computeFuelPlan({
      fuelLiters: 38,
      consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
    });
    const ctx: RaceContext = { raceState: multiClassTrafficState, fuelPlan };

    let n = 0;
    const fetchImpl: FetchLike = () => {
      n += 1;
      if (n === 1) {
        return Promise.resolve(
          okJson({
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: 'get_fuel_plan', arguments: {} } }],
            },
          }),
        );
      }
      return Promise.resolve(okJson({ message: { role: 'assistant', content: 'Fuel is good.' } }));
    };

    const provider = new OllamaProvider({ fetch: fetchImpl });
    const result = await runRadioTurn({
      provider,
      context: () => ctx,
      userMessage: "How's my fuel?",
    });

    expect(result.toolCalls.map((c) => c.name)).toEqual(['get_fuel_plan']);
    expect(result.text).toBe('Fuel is good.');
    expect(result.rounds).toBe(2);
  });
});
