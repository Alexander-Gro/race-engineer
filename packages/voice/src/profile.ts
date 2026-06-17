import { openAiStt, type CloudSttConfig } from './providers/cloud-stt';
import { openAiTts, type CloudTtsConfig } from './providers/cloud-tts';
import { FakeSttProvider } from './providers/fake-stt';
import { FakeTtsProvider } from './providers/fake-tts';
import {
  fasterWhisperStt,
  whisperCppStt,
  type LocalSttBackend,
  type LocalSttConfig,
} from './providers/local-stt';
import {
  kokoroTts,
  piperTts,
  type LocalTtsBackend,
  type LocalTtsConfig,
} from './providers/local-tts';
import type { SttProvider, TtsProvider } from './types';

/**
 * Config-only provider selection (build-plan T4.4 "provider-swap is config-only"; docs/15 §two
 * profiles). A {@link VoiceProviderConfig} names the TTS/STT engine; {@link selectTtsProvider} /
 * {@link selectSttProvider} turn that into a provider instance with no other code change. The
 * default is the **free, local** profile (docs/15) — it ships enabled and needs no key.
 *
 * Cloud (BYO-key) engines join this enum behind the same interface: `openai` cloud TTS is wired
 * (slice 3b — BYO-key, the fastest audible path on the dev Mac); more cloud STT/TTS (Deepgram/
 * ElevenLabs/…) follow. The native local backends are injected here once T10.1 wires them (until
 * then the local shells are not-ready — see `local-tts.ts`/`local-stt.ts`).
 */
export type TtsEngineId = 'fake' | 'piper' | 'kokoro' | 'openai';
export type SttEngineId = 'fake' | 'whisper-cpp' | 'faster-whisper' | 'openai';

export interface VoiceProviderConfig {
  tts: TtsEngineId;
  stt: SttEngineId;
  ttsConfig?: LocalTtsConfig;
  sttConfig?: LocalSttConfig;
  /** Native backends, wired in T10.1; absent ⇒ the selected local shell reports not-ready. */
  ttsBackend?: LocalTtsBackend;
  sttBackend?: LocalSttBackend;
  /** Cloud TTS (BYO-key) config for the `openai` engine; absent/empty key ⇒ reports not-ready. */
  cloudTtsConfig?: CloudTtsConfig;
  /** Cloud STT (BYO-key) config for the `openai` engine; absent/empty key ⇒ reports not-ready. */
  cloudSttConfig?: CloudSttConfig;
}

/**
 * The free profile (docs/15, default, ships enabled): fully local, no signup, no key. Defaults to the
 * engines that **actually have a native backend today — Piper (TTS) + whisper.cpp (STT)** — so the
 * default can speak/listen once its model paths are set, rather than pointing at an engine with no
 * backend (it would silently fall back to the fake). Kokoro + faster-whisper are the planned quality
 * upgrades; switch to them once their backends land.
 */
export const DEFAULT_VOICE_PROFILE: VoiceProviderConfig = { tts: 'piper', stt: 'whisper-cpp' };

export const selectTtsProvider = (config: VoiceProviderConfig): TtsProvider => {
  switch (config.tts) {
    case 'fake':
      return new FakeTtsProvider();
    case 'piper':
      return piperTts(config.ttsConfig, config.ttsBackend ?? null);
    case 'kokoro':
      return kokoroTts(config.ttsConfig, config.ttsBackend ?? null);
    case 'openai':
      return openAiTts(config.cloudTtsConfig ?? { apiKey: '' }); // no key ⇒ not-ready, caller falls back
    default: {
      const unknown: never = config.tts;
      throw new Error(`unknown TTS engine: ${String(unknown)}`);
    }
  }
};

export const selectSttProvider = (config: VoiceProviderConfig): SttProvider => {
  switch (config.stt) {
    case 'fake':
      return new FakeSttProvider();
    case 'whisper-cpp':
      return whisperCppStt(config.sttConfig, config.sttBackend ?? null);
    case 'faster-whisper':
      return fasterWhisperStt(config.sttConfig, config.sttBackend ?? null);
    case 'openai':
      return openAiStt(config.cloudSttConfig ?? { apiKey: '' }); // no key ⇒ not-ready, caller falls back
    default: {
      const unknown: never = config.stt;
      throw new Error(`unknown STT engine: ${String(unknown)}`);
    }
  }
};
