// @race-engineer/ai
// Provider-agnostic AI Engineer: read-only tools + orchestration (docs/06). The LLM only
// phrases tool output — it never computes numbers and has no write path to the game. Default
// is free: a local Ollama route or template mode; cloud Claude is opt-in, bring-your-own-key
// (docs/15). Voice (STT/TTS) wiring is M4; the live streaming radio loop is T5.2.
export type {
  ChatMessage,
  CompletionRequest,
  FetchLike,
  LlmProvider,
  ProviderResponse,
  ToolCall,
  ToolSpec,
} from './types';
export type { RaceContext, RaceContextProvider } from './context';
export { READ_ONLY_TOOLS, toolRegistry, toToolSpecs } from './tools';
export type { ToolDef } from './tools';
export { BASE_SYSTEM_PROMPT, buildSystemPrompt } from './prompt';
export type { Persona } from './prompt';
export { runRadioTurn } from './orchestrator';
export type { RadioTurnInput, RadioTurnResult, ExecutedToolCall } from './orchestrator';
export { checkSpokenNumbers, extractNumbers, collectToolNumbers } from './guard';
export type { HallucinationReport, SpokenNumber } from './guard';
export { FakeProvider } from './providers/fake';
export type { FakeStep } from './providers/fake';
export { OllamaProvider } from './providers/ollama';
export type { OllamaOptions } from './providers/ollama';
