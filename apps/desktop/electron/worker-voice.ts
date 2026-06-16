import {
  FakeSttProvider,
  FakeTtsProvider,
  prerenderTier0,
  RadioCapture,
  selectSttProvider,
  selectTtsProvider,
  type AudioClip,
  type SttProvider,
  type TtsProvider,
  type VoiceId,
  type VoiceProviderConfig,
} from '@race-engineer/voice';
import { IpcAudioSink, type AudioOutMessage } from '../src/audio-bridge';
import { BridgedMicSource } from '../src/mic-bridge';
import { createRadioReply } from '../src/radio-reply';
import { attachLocalBackends } from '../src/voice/local-backends';
import { EngineerVoice } from '../src/voice-engine';

/**
 * The worker's **voice layer** (Track A voice path, build-plan T10.1 slice 3b). Builds the engineer's
 * voice from the configured **voice route** and wires it to the renderer bridges:
 *
 *  - **audio out** (slice 1) — the {@link IpcAudioSink} serializes play/stop to the renderer;
 *  - **mic in** (slice 2) — a {@link BridgedMicSource} feeds a {@link RadioCapture};
 *  - **reactive reply** (slice 3a) — PTT-up transcript → provider-aware `answer` → spoken reply;
 *  - **real providers** (slice 3b) — TTS/STT come from `selectTts/SttProvider(route)`; a not-ready
 *    engine (no key / no native backend) **falls back to the fake** so the app never crashes, and a
 *    cloud pre-render failure (bad key / offline) falls back too.
 *
 * With a cloud TTS route + a key this is **audible in a real voice**; with the fakes it stays silent.
 * Read-only/advisory — audio in/out only, no game path.
 */
export interface WorkerVoice {
  voice: EngineerVoice;
  handleAudioEnded: (pid: number) => void;
  onPtt: (down: boolean) => void;
  handleMicFrame: (frame: Uint8Array) => void;
}

const VOICE: VoiceId = 'engineer-1';

/** The configured STT, or the offline fake when it isn't ready. */
const pickStt = (route: VoiceProviderConfig): SttProvider => {
  const selected = selectSttProvider(route);
  return selected.available === false ? new FakeSttProvider() : selected;
};

export const createWorkerVoice = async (
  post: (msg: AudioOutMessage) => void,
  answer: (question: string) => Promise<string>,
  route: VoiceProviderConfig,
  /** Surface a completed radio exchange (heard + reply) to the UI; the worker relays it to the renderer. */
  onRadioLog?: (msg: { heard: string; reply: string }) => void,
): Promise<WorkerVoice> => {
  // Supply the native local backends (Piper/whisper.cpp) for local engines whose binary path is
  // configured; otherwise the local shells stay not-ready and we fall back to the fake.
  const wired = attachLocalBackends(route);
  const selectedTts = selectTtsProvider(wired);
  // `audible` = a real TTS is producing sound (not the silent fake fallback). The renderer uses this to
  // decide whether to mute its free Web-Speech call-out fallback (avoid a robotic double-voice).
  let audible = selectedTts.available !== false;
  let tts: TtsProvider = audible ? selectedTts : new FakeTtsProvider();
  const stt = pickStt(wired);

  // Pre-render the Tier-0 spotter clips once (a cloud TTS makes ~6 calls here). If that fails (bad key
  // / offline), fall back to the free offline voice rather than leaving the engineer mute mid-race.
  let tier0Clips: ReadonlyMap<string, AudioClip>;
  try {
    tier0Clips = await prerenderTier0(tts, VOICE);
  } catch (err) {
    console.error('[voice] TTS pre-render failed — falling back to the offline voice', err);
    tts = new FakeTtsProvider();
    audible = false;
    tier0Clips = await prerenderTier0(tts, VOICE);
  }

  const sink = new IpcAudioSink(post);
  const engineerVoice = new EngineerVoice({ tts, sink, tier0Clips, voice: VOICE });

  const mic = new BridgedMicSource();
  const capture = new RadioCapture({ stt, mic });
  let lastHeard = '';
  const reply = createRadioReply({
    capture,
    answer,
    speak: (text) => void engineerVoice.speakReply(text),
    bargeIn: () => engineerVoice.bargeIn(),
    onEvent: (e) => {
      console.log(`[radio] ${e.kind}: "${e.text}"`);
      if (e.kind === 'heard') lastHeard = e.text;
      // Surface the exchange to the UI on the reply (so the driver sees what was heard + the answer,
      // even when the spoken reply is preempted by higher-priority call-outs or recognition was rough).
      else if (e.kind === 'reply') onRadioLog?.({ heard: lastHeard, reply: e.text });
    },
  });

  // Tell the renderer whether we're voicing call-outs audibly, so it can mute its Web-Speech fallback
  // (a real voice → renderer stays quiet; the silent fake → renderer keeps the free Web-Speech voice).
  post({ kind: 'voice-active', active: audible });

  return {
    voice: engineerVoice,
    handleAudioEnded: (pid) => sink.handleEnded(pid),
    onPtt: (down) => reply.onPtt(down),
    handleMicFrame: (frame) => mic.handleFrame(frame),
  };
};
