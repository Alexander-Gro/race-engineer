import { FakeTtsProvider, prerenderTier0, type VoiceId } from '@race-engineer/voice';
import { IpcAudioSink, type AudioOutMessage } from '../src/audio-bridge';
import { EngineerVoice } from '../src/voice-engine';

/**
 * The worker's **proactive voice** (Track A voice path, build-plan T10.1). It runs the radio layer
 * in the Core worker with no key and no LLM (free/offline default = `templatePhraser`), and now
 * drives a **real audio sink across the renderer↔worker bridge**: the {@link IpcAudioSink} serializes
 * the {@link VoicePlayer}'s play/stop commands to the renderer (over `post`), which plays them via Web
 * Audio and reports completion back through {@link WorkerVoice.handleAudioEnded}.
 *
 * Audible once a real TTS fills the clip bytes (`AudioClip.audio`); the default {@link FakeTtsProvider}
 * produces metadata-only clips, so the queue drains (renderer completes by `durationMs`) but plays
 * silence — the cloud/local TTS wiring is the next slice. Read-only/advisory — audio out only, no game
 * path.
 */
export interface WorkerVoice {
  voice: EngineerVoice;
  /** Feed a renderer-reported natural clip completion back to the queue (drains the next utterance). */
  handleAudioEnded: (pid: number) => void;
}

/** Build the proactive voice over the renderer audio bridge. `post` ships commands to the renderer. */
export const createWorkerVoice = async (
  post: (msg: AudioOutMessage) => void,
): Promise<WorkerVoice> => {
  const tts = new FakeTtsProvider();
  const voice: VoiceId = 'engineer-1';
  const tier0Clips = await prerenderTier0(tts, voice);
  const sink = new IpcAudioSink(post);
  const engineerVoice = new EngineerVoice({ tts, sink, tier0Clips, voice });
  return { voice: engineerVoice, handleAudioEnded: (pid) => sink.handleEnded(pid) };
};
