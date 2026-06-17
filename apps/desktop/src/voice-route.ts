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
  // One OpenAI key covers cloud TTS (slice 3b-i) and cloud STT (3b-iii) — the full talk-to-it loop.
  const openaiKey = secrets.getKey('openai') ?? '';
  const local = voice.local;
  return {
    tts: voice.tts,
    stt: voice.stt,
    ...(voice.tts === 'openai' ? { cloudTtsConfig: { apiKey: openaiKey } } : {}),
    ...(voice.stt === 'openai' ? { cloudSttConfig: { apiKey: openaiKey } } : {}),
    // Local engines (free/offline): carry the configured binary+model paths so `attachLocalBackends`
    // can wire the native backend (else the local shell stays not-ready and falls back to the fake).
    ...(voice.tts === 'piper' && local?.piper ? { ttsConfig: { ...local.piper } } : {}),
    ...(voice.stt === 'whisper-cpp' && local?.whisperCpp
      ? { sttConfig: { ...local.whisperCpp } }
      : {}),
  };
};

/**
 * Does this route select a cloud engine (so its premium, audible path activates with a key)?
 * Kept distinct from {@link voiceRouteIsLocalReady} so each readiness reason is independently testable.
 */
export const voiceRouteIsCloud = (route: VoiceProviderConfig): boolean =>
  route.tts === 'openai' || route.stt === 'openai';

/**
 * Is the selected local **TTS** engine ready to actually speak — can a native backend attach?
 * **Piper** needs its binary + model paths configured; **Kokoro** runs in-process via `kokoro-js`,
 * which self-downloads its model, so selecting it is enough (the model is fetched on first use). This
 * is the single source of truth shared by `attachLocalBackends` (whether to wire the backend) and the
 * worker build-gate (whether to build the voice layer) — so the two can't drift.
 */
export const ttsLocalReady = (route: VoiceProviderConfig): boolean =>
  (route.tts === 'piper' && !!route.ttsConfig?.binaryPath && !!route.ttsConfig?.modelPath) ||
  route.tts === 'kokoro';

/**
 * Is the selected local **STT** engine ready to transcribe — binary + model configured? Today only
 * whisper.cpp has a backend (faster-whisper is a follow-up).
 */
export const sttLocalReady = (route: VoiceProviderConfig): boolean =>
  route.stt === 'whisper-cpp' && !!route.sttConfig?.binaryPath && !!route.sttConfig?.modelPath;

/** A local (free/offline) route ready to produce real audio on at least one side (TTS or STT). */
export const voiceRouteIsLocalReady = (route: VoiceProviderConfig): boolean =>
  ttsLocalReady(route) || sttLocalReady(route);

/**
 * Should the worker build the (audible) voice layer for this route? True for a cloud route (BYO-key) or
 * a **ready local route** (free/offline binaries configured) — so selecting either in Settings turns the
 * real voice on without an env flag. An unconfigured local route (e.g. the default `kokoro`+`faster-
 * whisper` with no backends yet) stays off, leaving the silent `pnpm dev` demo untouched.
 */
export const voiceRouteIsReady = (route: VoiceProviderConfig): boolean =>
  voiceRouteIsCloud(route) || voiceRouteIsLocalReady(route);
