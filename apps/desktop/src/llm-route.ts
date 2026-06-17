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

/**
 * The vision (docs/15): the **free profile is local AI**, not the deterministic template. Given a
 * resolved route and a live Ollama probe, upgrade the free `template` route to the local Ollama engine
 * when it's actually running with a model pulled — so the engineer is LLM-generated at $0 out of the
 * box, degrading back to the template only when no local model is reachable. Any non-free route (the
 * user explicitly chose Ollama/cloud) is returned untouched. Pure — unit-tested; main awaits the probe.
 */
export const freeRouteWithLocalOllama = (
  route: LlmRouteConfig,
  ollama: { reachable: boolean; models: readonly string[] },
): LlmRouteConfig => {
  if (route.provider !== 'template') return route;
  if (!ollama.reachable || ollama.models.length === 0) return route;
  // Prefer a Qwen build (the vision's free engineer) among the pulled models, else the first.
  const model = ollama.models.find((m) => /qwen/i.test(m)) ?? ollama.models[0]!;
  return { provider: 'ollama', model };
};
