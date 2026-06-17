import type { VoiceProviderConfig } from '@race-engineer/voice';
import { sttLocalReady, ttsLocalReady } from '../voice-route';
import { kokoroTtsBackend } from './kokoro-backend';
import { defaultSpawn, piperTtsBackend } from './piper-backend';
import { whisperCppBackend } from './whisper-backend';

/**
 * Attach the native local-voice backends (T10.1) to a voice route, so a selected local engine actually
 * synthesizes/transcribes instead of falling back to the fake. The `selectTts/SttProvider` selector
 * already wires `route.ttsBackend`/`sttBackend` into the local shells (T4.4) — this is the desktop-side
 * glue that supplies them (the backends use `node:child_process`, so they live here, not in `voice`).
 *
 * **Honest readiness:** a backend is attached **only when its binary + model paths are configured**
 * (`ttsLocalReady`/`sttLocalReady` — the same predicates the worker build-gate uses, so attachment and
 * the gate can't drift). Without the paths the backend is left off, so `provider.available` stays false
 * and the worker falls back to the fake rather than spawning a missing binary at synth time.
 *
 * TTS backends: **Piper** (spawned binary + model paths) and **Kokoro** (in-process `kokoro-js`, an
 * optional dep that self-downloads its model). STT: **whisper-cpp** today (`faster-whisper` is a
 * follow-up, so that id still falls back to the fake). Read-only/advisory throughout — voice in/out only.
 */
export const attachLocalBackends = (route: VoiceProviderConfig): VoiceProviderConfig => {
  const next: VoiceProviderConfig = { ...route };

  if (ttsLocalReady(route)) {
    next.ttsBackend = route.tts === 'kokoro' ? kokoroTtsBackend() : piperTtsBackend();
  }

  if (sttLocalReady(route)) {
    next.sttBackend = whisperCppBackend({ spawn: defaultSpawn });
  }

  return next;
};
