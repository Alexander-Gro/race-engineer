import type Anthropic from '@anthropic-ai/sdk';
import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import { describe, expect, it, vi } from 'vitest';
import type { RaceContext } from '../context';
import { ClaudeProvider, runRadioTurn, toToolSpecs } from '../index';

/** A fake SDK client whose `messages.create` returns a scripted message and captures the params. */
const fakeClient = (
  reply: () => unknown,
  onParams?: (p: Anthropic.MessageCreateParams) => void,
): Anthropic =>
  ({
    messages: {
      create: (p: Anthropic.MessageCreateParams) => {
        onParams?.(p);
        return Promise.resolve(reply());
      },
    },
  }) as unknown as Anthropic;

describe('ClaudeProvider', () => {
  it('maps a tool_use response and builds a correct Messages request (BYO-key, no embedded key)', async () => {
    let captured: Anthropic.MessageCreateParams | null = null;
    const client = fakeClient(
      () => ({ content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_fuel_plan', input: {} }] }),
      (p) => (captured = p),
    );

    const provider = new ClaudeProvider({ client, model: 'claude-haiku-4-5', maxTokens: 512 });
    expect(provider.name).toBe('claude'); // constructed with no apiKey — nothing embedded
    const res = await provider.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'fuel?' }],
      tools: toToolSpecs(),
    });

    expect(res.toolCalls).toEqual([{ id: 'toolu_1', name: 'get_fuel_plan', args: {} }]);
    expect(res.text).toBeNull();

    expect(captured!.model).toBe('claude-haiku-4-5');
    expect(captured!.max_tokens).toBe(512);
    expect(captured!.system).toBe('sys');
    expect(captured!.messages).toEqual([{ role: 'user', content: 'fuel?' }]);
    const tool0 = captured!.tools?.[0] as Anthropic.Tool;
    expect(tool0.name).toBe('get_race_state');
    expect(tool0.input_schema.type).toBe('object');
  });

  it('maps a text response and defaults to a fast Haiku-class model (docs/06 tiering)', async () => {
    let captured: Anthropic.MessageCreateParams | null = null;
    const client = fakeClient(
      () => ({ content: [{ type: 'text', text: 'Fuel is good.' }] }),
      (p) => (captured = p),
    );
    const res = await new ClaudeProvider({ client }).complete({
      system: '',
      messages: [],
      tools: [],
    });
    expect(res.text).toBe('Fuel is good.');
    expect(res.toolCalls).toEqual([]);
    expect(captured!.model).toBe('claude-haiku-4-5');
    expect(captured!.max_tokens).toBe(1024);
  });

  it('maps assistant tool calls and tool results into Anthropic content blocks', async () => {
    let captured: Anthropic.MessageCreateParams | null = null;
    const client = fakeClient(
      () => ({ content: [{ type: 'text', text: 'ok' }] }),
      (p) => (captured = p),
    );
    await new ClaudeProvider({ client }).complete({
      system: 's',
      messages: [
        { role: 'user', content: 'fuel?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'toolu_1', name: 'get_fuel_plan', args: {} }],
        },
        {
          role: 'tool',
          toolCallId: 'toolu_1',
          name: 'get_fuel_plan',
          content: '{"lapsRemainingOnFuel":14.6}',
        },
      ],
      tools: [],
    });
    const msgs = captured!.messages;
    expect(msgs[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_fuel_plan', input: {} }],
    });
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"lapsRemainingOnFuel":14.6}' },
      ],
    });
  });

  it('drives a full radio turn through the orchestrator (tool → answer)', async () => {
    const ctx: RaceContext = {
      raceState: multiClassTrafficState,
      fuelPlan: computeFuelPlan({
        fuelLiters: 38,
        consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
      }),
    };
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_fuel_plan', input: {} }],
      })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Fuel is good.' }] });
    const client = { messages: { create } } as unknown as Anthropic;

    const result = await runRadioTurn({
      provider: new ClaudeProvider({ client }),
      context: () => ctx,
      userMessage: "how's my fuel",
    });

    expect(result.toolCalls.map((c) => c.name)).toEqual(['get_fuel_plan']);
    expect(result.text).toBe('Fuel is good.');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
