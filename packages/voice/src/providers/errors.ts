/**
 * Raised when a voice provider is selected but its backend isn't wired yet (the local shells
 * ship in T4.4; the native Piper/Kokoro/whisper bindings land in T10.1). A caller can catch this
 * to fall back to another provider in the chain rather than crashing mid-race (docs/15 §free routes).
 */
export class ProviderNotReadyError extends Error {
  /** The provider name (e.g. `piper`, `faster-whisper`). */
  readonly provider: string;

  constructor(provider: string, detail: string) {
    super(`Voice provider "${provider}" is not ready: ${detail}`);
    this.name = 'ProviderNotReadyError';
    this.provider = provider;
  }
}
