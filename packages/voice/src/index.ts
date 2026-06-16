// @race-engineer/voice
// Engineer voice output (docs/07): swappable TTS providers, a preemptible priority queue
// (urgent spotter > strategy > chatter, barge-in on PTT), and Tier-0 pre-render for
// near-zero-latency reflex call-outs. All logic is unit-testable with a fake provider + mock
// sink; real cloud (BYO-key) / local (Piper/Kokoro) providers and the OS audio sink are the
// live half (T4.4 / T10.1 / runtime). STT lands in T4.3.
export type {
  VoiceId,
  AudioChunk,
  AudioClip,
  AudioData,
  PlaybackHandle,
  AudioSink,
  TtsProvider,
  SttProvider,
  SttStream,
  SttResult,
  MicSource,
} from './types';
export { VoicePriority } from './types';
export { VoicePlayer } from './player';
export type { VoicePlayerOptions, VoicePlayerEvents, EnqueueOptions } from './player';
export { TIER0_PHRASES, prerenderTier0 } from './prerender';
export { speak, splitSentences, synthesizeClip } from './speak';
export type { SpeakOptions } from './speak';
export { RadioCapture } from './capture';
export type { RadioCaptureOptions, RadioCaptureEvents } from './capture';
export { FakeTtsProvider } from './providers/fake-tts';
export { FakeSttProvider } from './providers/fake-stt';
export { MockAudioSink } from './backends/mock-sink';
export { MockMicSource } from './backends/mock-mic';
// Local provider shells (T4.4) — free/offline default; native backends wired in T10.1.
export { ProviderNotReadyError } from './providers/errors';
export { CloudTtsProvider, openAiTts } from './providers/cloud-tts';
export type { CloudTtsConfig, CloudTtsFormat, TtsFetchLike } from './providers/cloud-tts';
export { CloudSttProvider, openAiStt } from './providers/cloud-stt';
export type { CloudSttConfig, SttFetchLike } from './providers/cloud-stt';
export { LocalTtsProvider, piperTts, kokoroTts } from './providers/local-tts';
export type { LocalTtsEngine, LocalTtsConfig, LocalTtsBackend } from './providers/local-tts';
export { LocalSttProvider, fasterWhisperStt, whisperCppStt } from './providers/local-stt';
export type {
  LocalSttEngine,
  LocalSttConfig,
  LocalSttBackend,
  SttStartOptions,
} from './providers/local-stt';
export { DEFAULT_VOICE_PROFILE, selectTtsProvider, selectSttProvider } from './profile';
export type { VoiceProviderConfig, TtsEngineId, SttEngineId } from './profile';
export { pcmToWav, MIC_SAMPLE_RATE_HZ } from './wav';
