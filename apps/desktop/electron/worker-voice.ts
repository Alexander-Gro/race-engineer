import {
  FakeSttProvider,
  FakeTtsProvider,
  prerenderTier0,
  RadioCapture,
  type VoiceId,
} from '@race-engineer/voice';
import { IpcAudioSink, type AudioOutMessage } from '../src/audio-bridge';
import { BridgedMicSource } from '../src/mic-bridge';
import { createRadioReply } from '../src/radio-reply';
import { EngineerVoice } from '../src/voice-engine';

/**
 * The worker's **proactive voice + reactive radio** (Track A voice path, build-plan T10.1). It runs
 * the radio layer in the Core worker, driving the renderer↔worker bridges:
 *
 *  - **audio out** (slice 1) — the {@link IpcAudioSink} serializes the {@link VoicePlayer}'s play/stop
 *    to the renderer, which plays it and acks completion via {@link WorkerVoice.handleAudioEnded};
 *  - **mic in** (slice 2) — a {@link BridgedMicSource} feeds a {@link RadioCapture}; renderer PTT
 *    edges drive begin/end ({@link WorkerVoice.onPtt}), frames arrive via
 *    {@link WorkerVoice.handleMicFrame};
 *  - **reactive reply** (slice 3) — on PTT-up the transcript is answered by the injected `answer`
 *    (the provider-aware {@link AskResponder}: free template *or* the configured LLM, hallucination-
 *    guarded) and the reply is spoken back out the audio-out bridge; PTT-down barges in.
 *
 * So the engineer now *hears a push-to-talk question and answers it aloud* — for free/no-key (template)
 * and, when a key is set, via the configured LLM. **Audible/understanding once real STT/TTS replace the
 * fakes** (slice 3b — cloud BYO-key fastest on the dev Mac; local Piper/Kokoro + faster-whisper the free
 * default). With the fakes the full plumbing runs and is logged (silent audio, fake transcript).
 * Read-only/advisory — audio in/out only, no game path.
 */
export interface WorkerVoice {
  voice: EngineerVoice;
  /** Feed a renderer-reported natural clip completion back to the queue (drains the next utterance). */
  handleAudioEnded: (pid: number) => void;
  /** A renderer PTT edge: down barges in + opens capture; up finalizes → answer → spoken reply. */
  onPtt: (down: boolean) => void;
  /** A captured mic frame from the renderer (routed into the active STT stream). */
  handleMicFrame: (frame: Uint8Array) => void;
}

/**
 * Build the proactive voice + reactive radio over the renderer audio/mic bridges. `post` ships audio
 * commands to the renderer; `answer` grounds a transcript (the worker passes `AskResponder.answer`).
 */
export const createWorkerVoice = async (
  post: (msg: AudioOutMessage) => void,
  answer: (question: string) => Promise<string>,
): Promise<WorkerVoice> => {
  const tts = new FakeTtsProvider();
  const voice: VoiceId = 'engineer-1';
  const tier0Clips = await prerenderTier0(tts, voice);
  const sink = new IpcAudioSink(post);
  const engineerVoice = new EngineerVoice({ tts, sink, tier0Clips, voice });

  // Reactive radio: a bridged mic + a deterministic STT for now (real STT = slice 3b). The transcript
  // is answered by the provider-aware responder and spoken back; the chain is logged for the dev loop.
  const mic = new BridgedMicSource();
  const capture = new RadioCapture({ stt: new FakeSttProvider(), mic });
  const reply = createRadioReply({
    capture,
    answer,
    speak: (text) => void engineerVoice.speakReply(text),
    bargeIn: () => engineerVoice.bargeIn(),
    onEvent: (e) => console.log(`[radio] ${e.kind}: "${e.text}"`),
  });

  return {
    voice: engineerVoice,
    handleAudioEnded: (pid) => sink.handleEnded(pid),
    onPtt: (down) => reply.onPtt(down),
    handleMicFrame: (frame) => mic.handleFrame(frame),
  };
};
