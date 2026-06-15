import {
  FakeTtsProvider,
  prerenderTier0,
  type AudioClip,
  type AudioSink,
  type PlaybackHandle,
} from '@race-engineer/voice';
import { EngineerVoice } from '../src/voice-engine';

/**
 * The worker's **free/offline proactive voice** (Track A voice path). It runs the radio layer in
 * the shell today with **no key, no LLM, and no audio device** — so the proactive call-out routing
 * is exercised end-to-end (logged) while the real OS audio sink, mic, wheel PTT, and a configured
 * provider land in T4.5/T6.3/T10.1. Read-only/advisory — produces (silent) audio only.
 */

/**
 * A no-op {@link AudioSink}: it "plays" a clip by completing it after its (optional) duration, so
 * the priority queue drains exactly as it will with a real device — but emits no sound. Replaced by
 * the OS/Electron output device in T4.5/T10.1.
 */
const headlessAudioSink = (): AudioSink => ({
  play(clip: AudioClip, opts: { volume: number; onEnded: () => void }): PlaybackHandle {
    const timer = setTimeout(opts.onEnded, clip.durationMs ?? 0);
    return { stop: () => clearTimeout(timer), setVolume: () => {} };
  },
  setOutputDevice: () => {},
});

/** Build the free proactive voice (template phraser + fake TTS + headless sink). Reactive PTT = T4.5. */
export const createWorkerVoice = async (): Promise<EngineerVoice> => {
  const tts = new FakeTtsProvider();
  const voice = 'engineer-1';
  const tier0Clips = await prerenderTier0(tts, voice);
  return new EngineerVoice({ tts, sink: headlessAudioSink(), tier0Clips, voice });
};
