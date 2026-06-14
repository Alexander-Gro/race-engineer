/**
 * Provider-agnostic LLM contracts (docs/06). The AI Engineer is **swappable**: a free local
 * model (Ollama/Qwen), a free cloud tier, or BYO-key Claude all implement {@link LlmProvider}
 * and the same read-only tool surface. Nothing here is Anthropic-specific.
 *
 * Two hard rules from docs/06 shape these types:
 *  - **No math in the model** — every number is produced by a read-only tool; the model only
 *    phrases tool output (see `tools.ts`).
 *  - **No write path** — there is no tool, message, or provider call that changes the game.
 */

/** One JSON-Schema-ish parameter spec passed to a provider's function-calling API. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (often `{ type: 'object', properties: {} }`). */
  parameters: Record<string, unknown>;
}

/** A tool-call the model requested this turn. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Conversation messages exchanged with a provider (our neutral shape; providers map to wire format). */
export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface CompletionRequest {
  /** Stable system prompt + persona + (implicitly) the tool schema — cache-friendly (docs/06). */
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}

/**
 * A single non-streaming completion. When `toolCalls` is non-empty the model wants tools run
 * and the orchestrator loops; otherwise `text` is the final answer. (Streaming is a per-
 * provider concern for the live radio loop in T5.2/T5.3; the orchestration contract is
 * non-streaming so it stays deterministically testable.)
 */
export interface ProviderResponse {
  text: string | null;
  toolCalls: ToolCall[];
}

/** The one method every LLM route implements. */
export interface LlmProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<ProviderResponse>;
}

/**
 * Minimal `fetch` shape used by HTTP providers (e.g. Ollama). Injectable so providers are
 * unit-testable without a live endpoint and without pulling DOM/node global typings.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
