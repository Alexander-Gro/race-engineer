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
 * Cloud (BYO-key) TTS/STT engines (ElevenLabs/Deepgram/…) join this enum behind the same
 * interface in the premium profile; the native local backends are injected here once T10.1 wires
 * them (until then the local shells are not-ready — see `local-tts.ts`/`local-stt.ts`).
 */
export type TtsEngineId = 'fake' | 'piper' | 'kokoro';
export type SttEngineId = 'fake' | 'whisper-cpp' | 'faster-whisper';

export interface VoiceProviderConfig {
  tts: TtsEngineId;
  stt: SttEngineId;
  ttsConfig?: LocalTtsConfig;
  sttConfig?: LocalSttConfig;
  /** Native backends, wired in T10.1; absent ⇒ the selected local shell reports not-ready. */
  ttsBackend?: LocalTtsBackend;
  sttBackend?: LocalSttBackend;
}

/** The free profile (docs/15, default, ships enabled): fully local, no signup, no key. */
export const DEFAULT_VOICE_PROFILE: VoiceProviderConfig = { tts: 'kokoro', stt: 'faster-whisper' };

export const selectTtsProvider = (config: VoiceProviderConfig): TtsProvider => {
  switch (config.tts) {
    case 'fake':
      return new FakeTtsProvider();
    case 'piper':
      return piperTts(config.ttsConfig, config.ttsBackend ?? null);
    case 'kokoro':
      return kokoroTts(config.ttsConfig, config.ttsBackend ?? null);
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
    default: {
      const unknown: never = config.stt;
      throw new Error(`unknown STT engine: ${String(unknown)}`);
    }
  }
};
