import type { VoiceProviderConfig } from '@race-engineer/voice';
import { defaultSpawn, piperTtsBackend } from './piper-backend';
import { whisperCppBackend } from './whisper-backend';

/**
 * Attach the native local-voice backends (T10.1) to a voice route, so a selected local engine actually
 * synthesizes/transcribes instead of falling back to the fake. The `selectTts/SttProvider` selector
 * already wires `route.ttsBackend`/`sttBackend` into the local shells (T4.4) — this is the desktop-side
 * glue that supplies them (the backends use `node:child_process`, so they live here, not in `voice`).
 *
 * **Honest readiness:** a backend is attached **only when its binary path is configured** (the model
 * manager / settings supply it). Without a path the backend is left off, so `provider.available` stays
 * false and the worker falls back to the fake rather than spawning a missing binary at synth time.
 *
 * Today's working free pair is **piper (TTS) + whisper-cpp (STT)**. `kokoro` (ONNX) and `faster-whisper`
 * have no native backend yet, so those engine ids still fall back until their backends land (follow-up).
 * Read-only/advisory throughout — voice in/out only.
 */
export const attachLocalBackends = (route: VoiceProviderConfig): VoiceProviderConfig => {
  const next: VoiceProviderConfig = { ...route };

  if (route.tts === 'piper' && route.ttsConfig?.binaryPath) {
    next.ttsBackend = piperTtsBackend();
  }

  if (route.stt === 'whisper-cpp' && route.sttConfig?.binaryPath && route.sttConfig?.modelPath) {
    next.sttBackend = whisperCppBackend({ spawn: defaultSpawn });
  }

  return next;
};
