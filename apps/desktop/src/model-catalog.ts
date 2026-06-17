import type { LlmProviderId } from './settings';

/**
 * Per-provider model metadata for the settings model-picker (T6.3 follow-up — "choose / add your own
 * AI model"). Pure data, app-side, so the picker is unit-tested and the **renderer never pulls a
 * provider runtime** (the `@race-engineer/ai` barrel drags in `@anthropic-ai/sdk` — kept out of the
 * renderer bundle). Read-only/advisory: choosing a model only changes which engineer phrases tool
 * output; nothing here is a write path to the game (CLAUDE.md rule 5).
 *
 * `default` MIRRORS each provider's own fallback in `packages/ai/src/providers/*` — the model used when
 * the field is left blank: ollama→`qwen3`, claude→`claude-haiku-4-5`, groq→`llama-3.3-70b-versatile`,
 * openrouter→`…:free`, gemini→`gemini-2.0-flash`. Keep these in sync if a provider default changes
 * (the catalog test pins coverage, not the literal strings). `suggestions` are autocomplete hints
 * only — never a hard allow-list; the user can always type any id their provider accepts.
 */
export interface ModelCatalogEntry {
  /** Model used when the field is blank (mirrors the provider default), or null for template mode. */
  readonly default: string | null;
  /** Autocomplete hints shown in the picker; never a hard allow-list. */
  readonly suggestions: readonly string[];
  /** One-line hint on how to add your own model for this provider. */
  readonly hint: string;
}

export const MODEL_CATALOG: Record<LlmProviderId, ModelCatalogEntry> = {
  template: {
    default: null,
    suggestions: [],
    hint: 'Template mode is deterministic and needs no model.',
  },
  ollama: {
    default: 'qwen3',
    suggestions: ['qwen3', 'qwen3:8b', 'qwen3:14b', 'llama3.1', 'qwen2.5'],
    hint: 'Any model pulled with `ollama pull <name>`. Your installed models are listed automatically.',
  },
  claude: {
    default: 'claude-haiku-4-5',
    suggestions: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
    hint: 'Any Anthropic model id.',
  },
  groq: {
    default: 'llama-3.3-70b-versatile',
    suggestions: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    hint: 'Any model id from your Groq console.',
  },
  openrouter: {
    default: 'meta-llama/llama-3.3-70b-instruct:free',
    suggestions: ['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen-2.5-72b-instruct'],
    hint: 'Any model slug from the OpenRouter catalogue (a `:free` slug costs nothing).',
  },
  gemini: {
    default: 'gemini-2.0-flash',
    suggestions: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    hint: 'Any Gemini model id.',
  },
};

/** The catalog entry for a provider (always defined — every {@link LlmProviderId} has one). */
export const modelCatalogFor = (provider: LlmProviderId): ModelCatalogEntry =>
  MODEL_CATALOG[provider];

/** True when the provider takes a model at all (everything except the deterministic template route). */
export const providerUsesModel = (provider: LlmProviderId): boolean =>
  MODEL_CATALOG[provider].default !== null;
