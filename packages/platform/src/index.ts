// @race-engineer/platform
// OS/runtime prerequisites (docs/16). T4.6 lands the local-model manager: first-run download +
// checksum + version-pin into the user-data dir (offline-bundle option), GPU/VRAM-aware route
// recommendation (CPU vs GPU; local LLM only with headroom beside the sim — docs/15 contention),
// and Ollama detect/guide. All logic is pure over injectable ports, so it's fully unit-tested with
// no network, no filesystem, and no GPU; the concrete Node/Windows port impls are the runtime half.
// Read-only/advisory: nothing here touches the game.
export type { Downloader, FileHasher, FileStore, GpuProbe, HttpGetJson } from './ports';
export { ModelManager, ModelChecksumError } from './models';
export type {
  ModelSpec,
  ModelKind,
  InstalledModel,
  EnsureModelOptions,
  ModelManagerOptions,
} from './models';
export { recommendRoute } from './gpu';
export type { GpuInfo, Accel, LlmRoute, RouteRecommendation, RouteOptions } from './gpu';
export { detectOllama, ollamaInstallGuide, resolveLlmRoute } from './ollama';
export type { OllamaStatus, ResolvedLlmRoute } from './ollama';
