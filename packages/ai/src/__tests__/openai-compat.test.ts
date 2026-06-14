import { describe, expect, it } from 'vitest';
import {
  OpenAiCompatProvider,
  geminiProvider,
  groqProvider,
  openRouterProvider,
  toToolSpecs,
} from '../index';
import type { FetchLike } from '../types';

const okJson = (obj: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(obj) });

describe('OpenAiCompatProvider (Groq / Gemini / OpenRouter)', () => {
  it('maps a tool_calls response and builds a correct request with the BYO key', async () => {
    let captured: {
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    } | null = null;
    const fetchImpl: FetchLike = (url, init) => {
      captured = {
        url,
        headers: init.headers,
        body: JSON.parse(init.body) as Record<string, unknown>,
      };
      return Promise.resolve(
        okJson({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'call_1', function: { name: 'get_fuel_plan', arguments: '{}' } },
                ],
              },
            },
          ],
        }),
      );
    };

    const res = await groqProvider({ apiKey: 'sk-test-123', fetch: fetchImpl }).complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: toToolSpecs(),
    });

    expect(res.toolCalls).toEqual([{ id: 'call_1', name: 'get_fuel_plan', args: {} }]);
    expect(res.text).toBeNull();

    expect(captured!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    // Uses the injected key — never an embedded one.
    expect(captured!.headers.authorization).toBe('Bearer sk-test-123');
    expect(captured!.body.model).toBe('llama-3.3-70b-versatile');
    const messages = captured!.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: 'system', content: 'sys' });
    const tools = captured!.body.tools as Array<{ function: { name: string } }>;
    expect(tools[0]?.function.name).toBe('get_race_state');
  });

  it('maps a text response', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(okJson({ choices: [{ message: { content: 'Fuel is good.' } }] }));
    const res = await new OpenAiCompatProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://x.example/v1',
      fetch: fetchImpl,
    }).complete({ system: '', messages: [], tools: [] });
    expect(res.text).toBe('Fuel is good.');
    expect(res.toolCalls).toEqual([]);
  });

  it('parses string-encoded args and maps assistant tool calls / tool results outward', async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl: FetchLike = (_url, init) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve(
        okJson({
          choices: [
            {
              message: {
                tool_calls: [{ id: 'c1', function: { name: 'x', arguments: '{"a":1}' } }],
              },
            },
          ],
        }),
      );
    };
    const res = await openRouterProvider({ apiKey: 'k', fetch: fetchImpl }).complete({
      system: 's',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'x', args: {} }] },
        { role: 'tool', toolCallId: 'c1', name: 'x', content: '{"ok":true}' },
      ],
      tools: [],
    });
    expect(res.toolCalls[0]?.args).toEqual({ a: 1 });

    const msgs = body!.messages as Array<Record<string, unknown>>;
    expect(msgs[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
    });
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' });
  });

  it('throws on a non-OK HTTP status', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
    await expect(
      geminiProvider({ apiKey: 'k', fetch: fetchImpl }).complete({
        system: '',
        messages: [],
        tools: [],
      }),
    ).rejects.toThrow(/401/);
  });

  it('preset factories set the right name and base URL', () => {
    expect(groqProvider({ apiKey: 'k' }).name).toBe('groq');
    expect(openRouterProvider({ apiKey: 'k' }).name).toBe('openrouter');
    expect(geminiProvider({ apiKey: 'k' }).name).toBe('gemini');
  });
});
