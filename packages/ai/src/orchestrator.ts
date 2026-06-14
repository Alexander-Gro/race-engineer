import type { RaceContextProvider } from './context';
import { buildSystemPrompt, type Persona } from './prompt';
import { READ_ONLY_TOOLS, type ToolDef, toolRegistry, toToolSpecs } from './tools';
import type { ChatMessage, LlmProvider, ToolCall } from './types';

/**
 * The reactive radio turn (docs/06 §Reactive): transcript → provider(+read-only tools) →
 * spoken answer. Provider-agnostic — Ollama/Qwen, a free cloud tier, or BYO-key Claude all
 * drop in behind {@link LlmProvider}. The orchestrator owns the tool loop and executes only
 * read-only tools, so the model can never reach a write path; it just phrases tool output.
 *
 * Non-streaming by design here (deterministically testable). The live loop's streaming +
 * provider-fallback chain is layered on in T5.2/T5.3 around this same contract.
 */

export interface RadioTurnInput {
  provider: LlmProvider;
  /** Snapshots the freshest race context each time a tool runs (docs/06 §Context). */
  context: RaceContextProvider;
  userMessage: string;
  tools?: readonly ToolDef[];
  /** Override the system prompt; otherwise built from `persona`. */
  system?: string;
  persona?: Persona;
  /** Prior dialogue turns (short rolling history). */
  history?: ChatMessage[];
  /** Safety bound on tool-call rounds before forcing a plain answer. */
  maxToolRounds?: number;
}

export interface ExecutedToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface RadioTurnResult {
  text: string;
  /** Every tool run this turn, with its result — the provenance for any number spoken. */
  toolCalls: ExecutedToolCall[];
  rounds: number;
  /** History + this turn, for the next turn / transcript. */
  messages: ChatMessage[];
}

const DEFAULT_MAX_TOOL_ROUNDS = 5;

const runTool = (
  registry: Map<string, ToolDef>,
  call: ToolCall,
  context: RaceContextProvider,
): unknown => {
  const tool = registry.get(call.name);
  if (!tool) return { error: `unknown tool: ${call.name}` };
  // Snapshot fresh, read-only context at call time (docs/06).
  return tool.handler(call.args, context());
};

export const runRadioTurn = async (input: RadioTurnInput): Promise<RadioTurnResult> => {
  const tools = input.tools ?? READ_ONLY_TOOLS;
  const registry = toolRegistry(tools);
  const specs = toToolSpecs(tools);
  const system = input.system ?? buildSystemPrompt(input.persona);
  const maxRounds = Math.max(1, input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS);

  const messages: ChatMessage[] = [
    ...(input.history ?? []),
    { role: 'user', content: input.userMessage },
  ];
  const executed: ExecutedToolCall[] = [];
  let rounds = 0;

  for (let i = 0; i < maxRounds; i += 1) {
    rounds += 1;
    const res = await input.provider.complete({ system, messages, tools: specs });

    if (res.toolCalls.length === 0) {
      const text = res.text ?? '';
      messages.push({ role: 'assistant', content: text });
      return { text, toolCalls: executed, rounds, messages };
    }

    // Record the model's tool-call request, then run each read-only tool and feed results back.
    messages.push({ role: 'assistant', content: res.text ?? '', toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      const result = runTool(registry, call, input.context);
      executed.push({ name: call.name, args: call.args, result });
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(result),
      });
    }
  }

  // Round cap reached while still calling tools — ask once for a plain answer.
  const final = await input.provider.complete({ system, messages, tools: specs });
  const text = final.text ?? '';
  messages.push({ role: 'assistant', content: text });
  return { text, toolCalls: executed, rounds: rounds + 1, messages };
};
