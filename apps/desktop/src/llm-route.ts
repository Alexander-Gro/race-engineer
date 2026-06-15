import type { LlmRouteConfig } from '@race-engineer/ai';
import type { SecretStore } from './secrets';
import { requiredSecretForLlm, type AppSettings } from './settings';

/**
 * Resolve the saved LLM setting + BYO-key into an {@link LlmRouteConfig} for `selectLlmProvider`
 * (build-plan T6.3 worker-apply). The key is read from OS secure storage at the last moment, on the
 * main/worker side only — it never crosses to the renderer. The free `template`/`ollama` routes need
 * no key. Read-only/advisory — this only configures which engineer answers, never the game.
 */
export const resolveLlmRouteConfig = (
  llm: AppSettings['llm'],
  secrets: Pick<SecretStore, 'getKey'>,
): LlmRouteConfig => {
  const slot = requiredSecretForLlm(llm.provider);
  const apiKey = slot ? secrets.getKey(slot) : null;
  return {
    provider: llm.provider,
    ...(apiKey ? { apiKey } : {}),
    ...(llm.model ? { model: llm.model } : {}),
  };
};
