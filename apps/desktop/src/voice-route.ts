import type { VoiceProviderConfig } from '@race-engineer/voice';
import type { SecretStore } from './secrets';
import type { AppSettings } from './settings';

/**
 * Resolve the saved voice setting + BYO-key into a {@link VoiceProviderConfig} for
 * `selectTts/SttProvider` (build-plan T10.1 slice 3b worker-apply). Mirrors {@link resolveLlmRouteConfig}:
 * the key is read from OS secure storage on the **main** side and handed to the worker on the
 * `configure` message — it never crosses to the renderer (rule 6). The result is **serializable** (engine
 * ids + a plain cloud config, no `fetch`/native backends), so it survives the worker postMessage; the
 * worker's `selectTtsProvider` uses the runtime's global `fetch`.
 *
 * Read-only/advisory — this only configures which voice speaks, never the game.
 */
export const resolveVoiceRoute = (
  voice: AppSettings['voice'],
  secrets: Pick<SecretStore, 'getKey'>,
): VoiceProviderConfig => {
  // One OpenAI key covers cloud TTS (slice 3b-i) and, later, cloud STT (3b-iii).
  const openaiKey = secrets.getKey('openai') ?? '';
  return {
    tts: voice.tts,
    stt: voice.stt,
    ...(voice.tts === 'openai' ? { cloudTtsConfig: { apiKey: openaiKey } } : {}),
  };
};

/**
 * Does this route select a cloud engine that should activate the premium (audible) voice path? The
 * worker builds the voice layer when this is true (or `ENGINEER_VOICE=1`), so picking a cloud engine in
 * Settings turns the real voice on without an env flag. Local engines stay off until their native
 * backend is wired (else they'd just fall back to silence).
 */
export const voiceRouteIsCloud = (route: VoiceProviderConfig): boolean => route.tts === 'openai';
