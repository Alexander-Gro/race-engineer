import { ClaudeProvider } from './providers/claude';
import { OllamaProvider } from './providers/ollama';
import { geminiProvider, groqProvider, openRouterProvider } from './providers/openai-compat';
import type { LlmProvider } from './types';

/**
 * Config-only LLM route selection (build-plan T6.3 worker-apply; docs/06 §swappable, docs/15). The
 * AI sibling of voice's `selectTtsProvider`: a saved route id + BYO-key becomes an {@link LlmProvider}
 * with no other code change. The free `template` route is **not** an LLM (it's the deterministic
 * `askEngineer` path), so selecting it returns `null` — the caller then answers via template mode.
 *
 * No network happens here: providers call the vendor directly at request time with the **user's own
 * key** (docs/15 — no central server, key from OS secure storage, never embedded). A cloud route with
 * no key throws a clear, actionable error rather than failing later mid-radio.
 */

/** The LLM routes the app can select. `template`/`ollama` need no key; the rest are BYO-key (T5.1b). */
export type LlmProviderId = 'template' | 'ollama' | 'claude' | 'groq' | 'openrouter' | 'gemini';

export interface LlmRouteConfig {
  provider: LlmProviderId;
  /** BYO-key for a cloud route (from OS secure storage). Required for claude/groq/openrouter/gemini. */
  apiKey?: string;
  /** Model override; otherwise the provider's default (docs/06 tiering / docs/15 free presets). */
  model?: string;
  /** Ollama endpoint override (local route). */
  baseUrl?: string;
}

const requireKey = (id: LlmProviderId, apiKey: string | undefined): string => {
  const key = apiKey?.trim();
  if (!key) {
    throw new Error(
      `The "${id}" engineer needs an API key — add one in Settings (stored securely).`,
    );
  }
  return key;
};

/** Build the configured {@link LlmProvider}, or `null` for the free `template` route. */
export const selectLlmProvider = (config: LlmRouteConfig): LlmProvider | null => {
  switch (config.provider) {
    case 'template':
      return null;
    case 'ollama':
      return new OllamaProvider({ model: config.model, baseUrl: config.baseUrl });
    case 'claude':
      return new ClaudeProvider({
        apiKey: requireKey('claude', config.apiKey),
        model: config.model,
      });
    case 'groq':
      return groqProvider({ apiKey: requireKey('groq', config.apiKey), model: config.model });
    case 'openrouter':
      return openRouterProvider({
        apiKey: requireKey('openrouter', config.apiKey),
        model: config.model,
      });
    case 'gemini':
      return geminiProvider({ apiKey: requireKey('gemini', config.apiKey), model: config.model });
    default: {
      const unknown: never = config.provider;
      throw new Error(`unknown LLM route: ${String(unknown)}`);
    }
  }
};
