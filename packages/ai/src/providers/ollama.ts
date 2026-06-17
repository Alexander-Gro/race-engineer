import type {
  CompletionRequest,
  FetchLike,
  LlmProvider,
  ProviderResponse,
  ToolCall,
} from '../types';

/**
 * Local, free, key-less LLM route (docs/15 Route B): talks to a running Ollama daemon over
 * its HTTP API — no account, no key, fully offline. Best with a 24 GB+ GPU or a second
 * machine on the LAN, since the sim already uses the primary GPU (docs/15 §GPU contention);
 * on a single-GPU rig prefer the free cloud tier or template mode. Qwen 3.x is the default
 * model — a strong local tool-caller, and our tool surface is simple read-only getters.
 *
 * `fetch` is injectable so this is unit-testable without a live daemon; it defaults to the
 * platform `fetch`.
 */
export interface OllamaOptions {
  /** Ollama model tag, e.g. 'qwen3', 'qwen3:8b'. Default 'qwen3'. */
  model?: string;
  /** Daemon base URL. Default 'http://localhost:11434'. */
  baseUrl?: string;
  /**
   * Whether to let a reasoning model (qwen3, etc.) "think" before answering. Default **false**: the
   * radio loop wants fast tool-phrasing, and the deterministic engine already did the reasoning
   * (docs/06 §tiered latency). Leaving thinking on multiplies latency ~10× (a qwen3 radio reply went
   * from ~6 s to ~50–100 s in rig testing) for no benefit — the LLM only narrates tool output here.
   */
  think?: boolean;
  fetch?: FetchLike;
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string };
}
interface OllamaChatResponse {
  message?: { role: string; content?: string; tool_calls?: OllamaToolCall[] };
}

const DEFAULT_MODEL = 'qwen3';
const DEFAULT_BASE = 'http://localhost:11434';

/**
 * Strip a reasoning model's chain-of-thought out of the spoken answer. With thinking disabled qwen3
 * still occasionally leaks a short `<think>…</think>` preamble into `content`; we never want that
 * narrated on the radio. Drops complete `<think>…</think>` blocks, then anything up to a stray closing
 * `</think>` (the leak shape), and trims. A clean answer (no tags) passes through untouched.
 */
const stripThinking = (text: string): string => {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const lastClose = out.toLowerCase().lastIndexOf('</think>');
  if (lastClose !== -1) out = out.slice(lastClose + '</think>'.length);
  return out.trim();
};

const parseArgs = (a: Record<string, unknown> | string | undefined): Record<string, unknown> => {
  if (typeof a === 'string') {
    try {
      return JSON.parse(a) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return a ?? {};
};

const toOllamaMessages = (req: CompletionRequest): Array<Record<string, unknown>> => {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: req.system }];
  for (const m of req.messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', content: m.content });
    } else if (m.role === 'assistant') {
      const entry: Record<string, unknown> = { role: 'assistant', content: m.content };
      if (m.toolCalls && m.toolCalls.length > 0) {
        entry.tool_calls = m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args },
        }));
      }
      out.push(entry);
    } else {
      out.push({ role: 'user', content: m.content });
    }
  }
  return out;
};

export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #think: boolean;
  readonly #fetch: FetchLike;

  constructor(opts: OllamaOptions = {}) {
    this.#model = opts.model ?? DEFAULT_MODEL;
    this.#baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.#think = opts.think ?? false;
    const f = opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!f) {
      throw new Error('OllamaProvider: no fetch available on this runtime; pass opts.fetch');
    }
    this.#fetch = f;
  }

  async complete(req: CompletionRequest): Promise<ProviderResponse> {
    const body = JSON.stringify({
      model: this.#model,
      stream: false,
      think: this.#think,
      messages: toOllamaMessages(req),
      tools: req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    });

    const res = await this.#fetch(`${this.#baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const msg = data.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => ({
      id: `ollama_${i}`,
      name: tc.function.name,
      args: parseArgs(tc.function.arguments),
    }));
    const text = msg?.content ? stripThinking(msg.content) : '';
    return { text: text ? text : null, toolCalls };
  }
}
