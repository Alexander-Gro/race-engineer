import type { LlmRoute, RouteRecommendation } from './gpu';
import type { HttpGetJson } from './ports';

/**
 * Ollama detect/guide (build-plan T4.6, docs/16 §2): probe the local Ollama daemon (the free,
 * offline local-LLM route — docs/15 Route B) and, if the GPU recommendation wants a local LLM but
 * Ollama isn't ready, fall back to the free cloud tier and surface install guidance. The HTTP
 * getter is injectable, so detection is unit-tested with no daemon.
 */
export interface OllamaStatus {
  /** The daemon answered on its HTTP API. */
  reachable: boolean;
  baseUrl: string;
  /** Installed model tags (e.g. `qwen3:8b`). */
  models: string[];
}

const DEFAULT_BASE = 'http://localhost:11434';

/** Probe `GET <base>/api/tags`. Unreachable/error ⇒ `reachable: false` (never throws). */
export const detectOllama = async (
  get: HttpGetJson,
  baseUrl: string = DEFAULT_BASE,
): Promise<OllamaStatus> => {
  const base = baseUrl.replace(/\/+$/, '');
  try {
    const res = await get(`${base}/api/tags`);
    if (!res.ok) return { reachable: false, baseUrl: base, models: [] };
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string');
    return { reachable: true, baseUrl: base, models };
  } catch {
    return { reachable: false, baseUrl: base, models: [] };
  }
};

/** Windows-friendly install guidance shown when the local-LLM route is wanted but Ollama isn't ready. */
export const ollamaInstallGuide = (): string =>
  'Ollama is not running. Install it from https://ollama.com/download, then run:\n' +
  '  ollama pull qwen3\n' +
  '  ollama serve\n' +
  'Race Engineer will use it as the free, offline local-LLM route.';

export interface ResolvedLlmRoute {
  route: LlmRoute;
  /** Set when the recommended route can't be used yet (e.g. local recommended but Ollama not ready). */
  guide?: string;
}

/**
 * Combine the GPU recommendation with live Ollama status into the final route (build-plan T4.6:
 * "recommend the LLM route"). A `local` recommendation needs Ollama reachable with at least one
 * model pulled; otherwise it degrades to the free cloud tier with install guidance. The deterministic
 * **template mode** remains the universal offline fallback under every route (docs/15 Route C).
 */
export const resolveLlmRoute = (
  recommendation: RouteRecommendation,
  ollama: OllamaStatus,
): ResolvedLlmRoute => {
  if (recommendation.llm === 'local') {
    if (ollama.reachable && ollama.models.length > 0) return { route: 'local' };
    return { route: 'cloud-tier', guide: ollamaInstallGuide() };
  }
  return { route: recommendation.llm };
};
