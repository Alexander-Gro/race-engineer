import type { LlmProvider } from '@race-engineer/ai';
import {
  FakeSttProvider,
  FakeTtsProvider,
  RadioCapture,
  selectSttProvider,
  selectTtsProvider,
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
  /**
   * The configured LLM (or null for template mode). When present, proactive call-outs are
   * **LLM-generated from the live data with an emotional tone** (the vision in CLAUDE.md), via
   * `EngineerVoice`'s default `engineerPhraser`; null falls back to the calm template phraser. The
   * reactive reply path keeps using the provider-aware `answer` either way.
   */
  provider: LlmProvider | null = null,
  /** Surface a completed radio exchange (heard + reply) to the UI; the worker relays it to the renderer. */
  onRadioLog?: (msg: { heard: string; reply: string }) => void,
): Promise<WorkerVoice> => {
  // Supply the native local backends (Piper/whisper.cpp) for local engines whose binary path is
  // configured; otherwise the local shells stay not-ready and we fall back to the fake.
  const wired = attachLocalBackends(route);
  const selectedTts = selectTtsProvider(wired);
  // `audible` = a real TTS is producing sound (not the silent fake fallback). The renderer uses this to
  // decide whether to mute its free Web-Speech call-out fallback (avoid a robotic double-voice).
  const audible = selectedTts.available !== false;
  const tts: TtsProvider = audible ? selectedTts : new FakeTtsProvider();
  const stt = pickStt(wired);

  const sink = new IpcAudioSink(post);
  // With a provider, EngineerVoice's default proactive phraser is the context-aware `engineerPhraser`
  // (reasons over the live snapshot via read-only tools, emits a tone-tagged call-out) — the vision.
  // Without one, it stays the calm template phraser. No `capture` is passed, so EngineerVoice's own
  // reactive loop stays off — replies run through the worker's `createRadioReply` + `speakReply` path.
  const engineerVoice = new EngineerVoice({
    tts,
    sink,
    voice: VOICE,
    ...(provider ? { provider } : {}),
    // Make a silent degrade visible: if the AI call-out turn throws (e.g. Ollama not running), the
    // engineer falls back to the pre-written template — log it so it isn't mistaken for "no AI".
    onProactiveFallback: (err, event) =>
      console.warn(
        `[voice] proactive AI turn failed for "${event.type}" — using the pre-written template. ` +
          `Is the engineer model (Ollama/cloud) running?`,
        err,
      ),
    // A call-out was dropped because a spoken number didn't trace to a tool result (silence > a wrong
    // number on an unsolicited call). Log it so the model's number discipline is observable.
    onProactiveHallucination: (report, event) =>
      console.warn(
        `[voice] dropped "${event.type}" call-out — ungrounded number(s): ` +
          `${report.ungrounded.map((u) => u.text).join(', ')}`,
      ),
  });

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
