import type {
  ChatMessage,
  CompletionRequest,
  FetchLike,
  LlmProvider,
  ProviderResponse,
  ToolCall,
} from '../types';

/**
 * OpenAI-compatible Chat Completions provider (docs/15 Route A — free cloud tier). One client
 * for **Groq / Gemini / OpenRouter** (and any OpenAI-compatible endpoint): they share the same
 * `/chat/completions` wire shape with function-calling. **Opt-in, bring-your-own-key** — the key
 * comes from OS secure storage and is never embedded (CLAUDE.md rule 6). `fetch` is injectable,
 * so this is unit-testable with no key and no network (same pattern as the Ollama route).
 *
 * Per docs/06 the LLM only phrases tool output; the deterministic engine does the math.
 */
export interface OpenAiCompatOptions {
  apiKey: string;
  /** Model id (provider-specific). */
  model: string;
  /** API base, e.g. `https://api.groq.com/openai/v1`. */
  baseUrl: string;
  /** Display name (e.g. `groq`). Default `openai-compat`. */
  name?: string;
  fetch?: FetchLike;
}

interface OpenAiToolCall {
  id?: string;
  function: { name: string; arguments: string };
}
interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }>;
}

const parseArgs = (raw: string): Record<string, unknown> => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const toOpenAiMessages = (
  system: string,
  messages: readonly ChatMessage[],
): Array<Record<string, unknown>> => {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    } else {
      const entry: Record<string, unknown> = { role: 'assistant', content: m.content || null };
      if (m.toolCalls && m.toolCalls.length > 0) {
        entry.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      out.push(entry);
    }
  }
  return out;
};

export class OpenAiCompatProvider implements LlmProvider {
  readonly name: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;

  constructor(opts: OpenAiCompatOptions) {
    this.name = opts.name ?? 'openai-compat';
    this.#apiKey = opts.apiKey;
    this.#model = opts.model;
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, '');
    const f = opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) {
      throw new Error(`${this.name}: no fetch available on this runtime; pass opts.fetch`);
    }
    this.#fetch = f;
  }

  async complete(req: CompletionRequest): Promise<ProviderResponse> {
    const body = JSON.stringify({
      model: this.#model,
      messages: toOpenAiMessages(req.system, req.messages),
      tools: req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
      stream: false,
    });

    const res = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#apiKey}` },
      body,
    });
    if (!res.ok) {
      throw new Error(`${this.name} request failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as OpenAiResponse;
    const msg = data.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function.name,
      args: parseArgs(tc.function.arguments),
    }));
    return { text: msg?.content ? msg.content : null, toolCalls };
  }
}

interface PresetOptions {
  apiKey: string;
  model?: string;
  fetch?: FetchLike;
}

/** Groq free tier (docs/15) — very low latency. Default model: Llama 3.3 70B. */
export const groqProvider = (opts: PresetOptions): OpenAiCompatProvider =>
  new OpenAiCompatProvider({
    name: 'groq',
    apiKey: opts.apiKey,
    model: opts.model ?? 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
    fetch: opts.fetch,
  });

/** OpenRouter free tier (docs/15) — rotating free models; pick one per the OpenRouter catalogue. */
export const openRouterProvider = (opts: PresetOptions): OpenAiCompatProvider =>
  new OpenAiCompatProvider({
    name: 'openrouter',
    apiKey: opts.apiKey,
    model: opts.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    fetch: opts.fetch,
  });

/** Google Gemini free tier (docs/15) via its OpenAI-compatible endpoint. Default: Gemini Flash. */
export const geminiProvider = (opts: PresetOptions): OpenAiCompatProvider =>
  new OpenAiCompatProvider({
    name: 'gemini',
    apiKey: opts.apiKey,
    model: opts.model ?? 'gemini-2.0-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    fetch: opts.fetch,
  });
