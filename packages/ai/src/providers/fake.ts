import type {
  ChatMessage,
  CompletionRequest,
  LlmProvider,
  ProviderResponse,
  ToolCall,
} from '../types';

/**
 * A deterministic, scripted provider for tests (no network, no key). Each step is either a
 * set of tool calls to request, or a final answer. A final answer may be a function of the
 * tool results seen so far — which is exactly how we prove a spoken number came from a tool
 * (no invented figures, per docs/06 §Hard rules) without any live model.
 */
export type FakeStep =
  | { tools: Array<{ name: string; args?: Record<string, unknown> }> }
  | { text: string | ((toolResults: Record<string, unknown>) => string) };

const latestToolResults = (messages: ChatMessage[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const m of messages) {
    if (m.role === 'tool') {
      try {
        out[m.name] = JSON.parse(m.content);
      } catch {
        out[m.name] = m.content;
      }
    }
  }
  return out;
};

export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly #steps: FakeStep[];
  #i = 0;

  constructor(steps: FakeStep[]) {
    this.#steps = steps;
  }

  complete(req: CompletionRequest): Promise<ProviderResponse> {
    const step = this.#steps[this.#i] ?? { text: '' };
    this.#i += 1;

    if ('tools' in step) {
      const toolCalls: ToolCall[] = step.tools.map((t, j) => ({
        id: `call_${this.#i}_${j}`,
        name: t.name,
        args: t.args ?? {},
      }));
      return Promise.resolve({ text: null, toolCalls });
    }

    const text =
      typeof step.text === 'function' ? step.text(latestToolResults(req.messages)) : step.text;
    return Promise.resolve({ text, toolCalls: [] });
  }
}
