import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  CompletionRequest,
  LlmProvider,
  ProviderResponse,
  ToolCall,
  ToolSpec,
} from '../types';

/**
 * Anthropic Claude provider (docs/06, docs/15 premium profile) — the **opt-in, bring-your-own-key**
 * cloud route behind {@link LlmProvider}. Uses the official `@anthropic-ai/sdk` (Messages API +
 * tool use). The key is supplied by the app from OS secure storage and **never embedded** in the
 * repo, a default, or a log (CLAUDE.md rule 6).
 *
 * Default model is a **fast Haiku-class** model — docs/06 §Model tiering routes snappy radio
 * replies to a fast model (the deterministic engine does the reasoning; the LLM only phrases tool
 * output). Pass a larger model (e.g. `claude-opus-4-8`) for deliberative strategy.
 *
 * The SDK client is injectable so this is unit-testable with no key and no network.
 */
export interface ClaudeOptions {
  /** BYO-key from OS secure storage. Omit only when injecting {@link ClaudeOptions.client}. */
  apiKey?: string;
  /** Model id. Default `claude-haiku-4-5` (docs/06 fast tier). */
  model?: string;
  /** Output cap. Radio replies are short; default 1024. */
  maxTokens?: number;
  /** Injectable SDK client (tests pass a fake; production constructs one from `apiKey`). */
  client?: Anthropic;
}

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Our neutral {@link ChatMessage}s → Anthropic Messages (tool_use / tool_result content blocks).
 * An assistant turn with neither text nor tool calls is **dropped**: it carries nothing, and the
 * Anthropic API rejects empty assistant content (400). This happens when a prior turn produced no
 * text — e.g. a refusal — and the empty answer was kept in the rolling dialogue history.
 */
const toAnthropicMessages = (messages: readonly ChatMessage[]): Anthropic.MessageParam[] => {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
      });
      continue;
    }
    // assistant: optional text + any tool-call requests it made.
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (m.content) blocks.push({ type: 'text', text: m.content });
    for (const tc of m.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
    }
    if (blocks.length > 0) out.push({ role: 'assistant', content: blocks });
  }
  return out;
};

const toAnthropicTools = (tools: readonly ToolSpec[]): Anthropic.Tool[] =>
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));

const fromAnthropicMessage = (message: Anthropic.Message): ProviderResponse => {
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const block of message.content) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        args: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  // Safety classifiers can decline (stop_reason 'refusal') with empty content — text stays null.
  return { text: text.length > 0 ? text : null, toolCalls };
};

export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude';
  readonly #client: Anthropic;
  readonly #model: string;
  readonly #maxTokens: number;

  constructor(opts: ClaudeOptions = {}) {
    this.#client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
    this.#model = opts.model ?? DEFAULT_MODEL;
    this.#maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(req: CompletionRequest): Promise<ProviderResponse> {
    const message = await this.#client.messages.create({
      model: this.#model,
      max_tokens: this.#maxTokens,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools: toAnthropicTools(req.tools),
    });
    return fromAnthropicMessage(message);
  }
}
