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
