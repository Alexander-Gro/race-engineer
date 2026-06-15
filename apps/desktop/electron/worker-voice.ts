import {
  FakeSttProvider,
  FakeTtsProvider,
  prerenderTier0,
  RadioCapture,
  type VoiceId,
} from '@race-engineer/voice';
import { IpcAudioSink, type AudioOutMessage } from '../src/audio-bridge';
import { BridgedMicSource } from '../src/mic-bridge';
import { EngineerVoice } from '../src/voice-engine';

/**
 * The worker's **proactive voice + radio capture** (Track A voice path, build-plan T10.1). It runs the
 * radio layer in the Core worker with no key and no LLM (free/offline default), driving:
 *
 *  - **audio out** across the renderer↔worker bridge — the {@link IpcAudioSink} serializes the
 *    {@link VoicePlayer}'s play/stop to the renderer (slice 1), which plays it and reports completion
 *    back via {@link WorkerVoice.handleAudioEnded};
 *  - **mic in** across the renderer→worker bridge — a {@link BridgedMicSource} feeds a
 *    {@link RadioCapture}; PTT edges from the renderer drive begin/end ({@link WorkerVoice.onPtt}) and
 *    captured frames arrive via {@link WorkerVoice.handleMicFrame} (slice 2).
 *
 * Audible/understanding once **real** TTS/STT providers replace the fakes (slice 3 — cloud BYO-key is
 * fastest on the dev Mac; local Piper/Kokoro + faster-whisper is the free default). For now the
 * captured transcript is logged (the FakeSttProvider won't understand real audio bytes — this slice
 * proves the capture *plumbing*: PTT-gated mic → frames → STT stream → transcript). The
 * transcript→AI→spoken-reply loop is slice 3. Read-only/advisory — audio in/out only, no game path.
 */
export interface WorkerVoice {
  voice: EngineerVoice;
  /** Feed a renderer-reported natural clip completion back to the queue (drains the next utterance). */
  handleAudioEnded: (pid: number) => void;
  /** A renderer PTT edge: down opens the radio capture, up finalizes it (logs the transcript). */
  onPtt: (down: boolean) => void;
  /** A captured mic frame from the renderer (routed into the active STT stream). */
  handleMicFrame: (frame: Uint8Array) => void;
}

/** Build the proactive voice + radio capture over the renderer audio/mic bridges. */
export const createWorkerVoice = async (
  post: (msg: AudioOutMessage) => void,
): Promise<WorkerVoice> => {
  const tts = new FakeTtsProvider();
  const voice: VoiceId = 'engineer-1';
  const tier0Clips = await prerenderTier0(tts, voice);
  const sink = new IpcAudioSink(post);
  const engineerVoice = new EngineerVoice({ tts, sink, tier0Clips, voice });

  // Radio capture (mic in): a bridged mic + a deterministic STT for now. PTT down → begin; up →
  // finalize. The transcript is logged here; wiring it to the AI + a spoken reply is slice 3.
  const mic = new BridgedMicSource();
  const capture = new RadioCapture({
    stt: new FakeSttProvider(),
    mic,
    events: {
      onFinal: (result) => {
        if (result.transcript) console.log(`[radio] heard: "${result.transcript}"`);
      },
    },
  });

  return {
    voice: engineerVoice,
    handleAudioEnded: (pid) => sink.handleEnded(pid),
    onPtt: (down) => {
      if (down) capture.begin();
      else void capture.end();
    },
    handleMicFrame: (frame) => mic.handleFrame(frame),
  };
};
