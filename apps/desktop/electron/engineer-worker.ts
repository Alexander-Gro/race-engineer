import { selectLlmProvider } from '@race-engineer/ai';
import type { EngineerEvent } from '@race-engineer/core';
import type { EngineerSnapshot, SnapshotTransport } from '@race-engineer/engineer-core';
import type { ProactivityLevel } from '@race-engineer/radio';
import type { VoiceProviderConfig } from '@race-engineer/voice';
import { AskResponder, type MainToWorkerMessage, type WorkerMessage } from '../src/ask';
import type { AudioOutMessage } from '../src/audio-bridge';
import { createSyntheticEngineerCore } from '../src/host';
import { voiceRouteIsReady } from '../src/voice-route';
import type { EngineerVoice } from '../src/voice-engine';

/**
 * Engineer Core worker (build-plan T6.1 + Track A voice path) — runs in the Electron utility process
 * so the tick pipeline stays **off the UI thread**. It `postMessage`s throttled snapshots to the main
 * process (forwarded to the renderer), answers **text questions** via the provider-aware
 * {@link AskResponder}, and routes detected events + push-to-talk to the **voice layer**.
 * Read-only/advisory: the worker only reads telemetry and phrases output; no path to the game.
 *
 * Source is chosen by `ENGINEER_SOURCE`: default → offline **synthetic** (`pnpm dev`); `lmu` → the real
 * **shared-memory** source (`pnpm dev:lmu`, koffi dynamically imported only when selected).
 *
 * **Voice layer (T10.1 slice 3b):** built/rebuilt from the configured **voice route** on each
 * `configure` (so picking a cloud engine — or a configured free/offline local engine — in Settings turns
 * the real voice on live). It activates when the route is ready ({@link voiceRouteIsReady}: a cloud
 * engine with a key, or a local engine whose binary+model paths are configured) or `ENGINEER_VOICE=1`
 * (the offline preview) — otherwise it stays off so the default `pnpm dev` demo is untouched and the
 * voice/radio/ai graph is dynamically imported only when needed. A bad cloud key / offline pre-render
 * falls back to the free offline voice rather than crashing (docs/16 §1 "never crash").
 */
const responder = new AskResponder();
// The voice layer + its bridge hooks, (re)built on configure; null until a route activates it.
let voice: EngineerVoice | null = null;
let handleAudioEnded: ((pid: number) => void) | null = null;
let onPtt: ((down: boolean) => void) | null = null;
let handleMicFrame: ((frame: Uint8Array) => void) | null = null;
let proactivity: ProactivityLevel = 'normal';
let latestSnapshot: EngineerSnapshot | null = null;

const post = (audio: AudioOutMessage): void =>
  process.parentPort.postMessage({ type: 'audio', audio } satisfies WorkerMessage);
// The reactive reply + text-ask share this provider-aware brain (template or configured LLM, guarded).
const answer = (question: string): Promise<string> => responder.answer(question);

// Build the voice layer only for a ready route — cloud (key) or a configured local engine — or when
// the offline preview flag is on. An unconfigured route stays off (silent `pnpm dev` demo untouched).
const shouldBuildVoice = (route: VoiceProviderConfig): boolean =>
  voiceRouteIsReady(route) || process.env['ENGINEER_VOICE'] === '1';

// Rebuilds are serialized + de-duped by route, so rapid settings/secret saves can't race or rebuild
// for an unchanged route (a rebuild re-pre-renders Tier-0, which for a cloud TTS costs network calls).
let lastVoiceRouteKey: string | null = null;
let voiceBuildChain: Promise<void> = Promise.resolve();

const rebuildVoice = (route: VoiceProviderConfig): void => {
  if (!shouldBuildVoice(route)) return;
  const key = JSON.stringify(route);
  if (key === lastVoiceRouteKey) return; // unchanged — keep the current voice
  lastVoiceRouteKey = key;
  voiceBuildChain = voiceBuildChain.then(async () => {
    try {
      const wv = await (await import('./worker-voice')).createWorkerVoice(post, answer, route);
      voice = wv.voice;
      handleAudioEnded = wv.handleAudioEnded;
      onPtt = wv.onPtt;
      handleMicFrame = wv.handleMicFrame;
      voice.setProactivity(proactivity);
      if (latestSnapshot) voice.onSnapshot(latestSnapshot); // catch up to the freshest telemetry
      console.log(`[voice] layer ready (tts=${route.tts}, stt=${route.stt})`);
    } catch (err) {
      console.error('[voice] failed to build the voice layer — staying silent', err);
    }
  });
};

// Main-relayed messages on the parent port: text questions, engineer/voice config, audio + radio I/O.
process.parentPort.on('message', (event: { data: MainToWorkerMessage }): void => {
  const msg = event.data;
  if (msg?.type === 'ask') {
    void responder
      .answer(msg.question)
      .then((reply) => {
        process.parentPort.postMessage({
          type: 'ask-reply',
          id: msg.id,
          answer: reply,
        } satisfies WorkerMessage);
      })
      .catch((err) => {
        // Never leave the renderer's invoke hanging — reply with a safe message and log.
        console.error('[ask] answering failed', err);
        process.parentPort.postMessage({
          type: 'ask-reply',
          id: msg.id,
          answer: "Sorry — I couldn't answer that just now.",
        } satisfies WorkerMessage);
      });
  } else if (msg?.type === 'configure') {
    // Apply the saved engineer route. A bad/keyless cloud route throws — fall back to template mode
    // rather than crash (docs/15 §fallback); the renderer never sent us the key, main did.
    try {
      responder.setProvider(selectLlmProvider(msg.llmRoute));
    } catch (err) {
      console.error('[configure] invalid LLM route — using free template mode', err);
      responder.setProvider(null);
    }
    proactivity = msg.proactivity;
    voice?.setProactivity(proactivity);
    rebuildVoice(msg.voiceRoute); // (re)build the voice layer if the route activates/changed it
  } else if (msg?.type === 'audio-ended') {
    handleAudioEnded?.(msg.pid); // renderer finished a clip → drain the next utterance
  } else if (msg?.type === 'radio-ptt') {
    onPtt?.(msg.down); // a PTT edge drives the radio capture lifecycle
  } else if (msg?.type === 'radio-frame') {
    handleMicFrame?.(msg.frame); // a captured mic frame → the active STT stream
  }
});

// Tell main we're listening, so it sends the engineer-route config (avoids a fork/postMessage race).
process.parentPort.postMessage({ type: 'ready' } satisfies WorkerMessage);

void (async (): Promise<void> => {
  const source = process.env['ENGINEER_SOURCE'] === 'lmu' ? 'lmu' : 'synthetic';

  const transport: SnapshotTransport = (snapshot): void => {
    latestSnapshot = snapshot;
    responder.update(snapshot);
    voice?.onSnapshot(snapshot); // mutable — picks up a voice (re)built mid-stream
    process.parentPort.postMessage({ type: 'snapshot', snapshot } satisfies WorkerMessage);
  };

  // Always wired; routes only when a voice layer exists. Fire-and-forget off the tick thread — a
  // synth/TTS failure must never crash the worker (docs/16 §1) — log and move on.
  const onEvent = (events: readonly EngineerEvent[]): void => {
    if (!voice) return;
    void voice
      .routeEvents(events)
      .then((outcomes) => {
        for (const o of outcomes) {
          const detail = o.kind === 'skipped' ? o.reason : `priority ${o.priority}`;
          console.log(`[voice] ${o.event.type} → ${o.kind} (${detail})`);
        }
      })
      .catch((err) => console.error('[voice] proactive routing failed', err));
  };

  try {
    if (source === 'lmu') {
      console.log(
        '[engineer-worker] source=lmu — reading shared memory (waiting for an LMU session)',
      );
      const { createLmuEngineerCore } = await import('../src/lmu-host');
      await createLmuEngineerCore(transport, { snapshotHz: 12, onEvent }).start();
    } else {
      // Pace + loop the synthetic source so the dashboard shows continuous, evolving values (a real
      // game emits in real time; the finite scenario would otherwise flash past before the UI subscribes).
      await createSyntheticEngineerCore(transport, {
        snapshotHz: 12,
        frameIntervalMs: 150,
        loop: true,
        onEvent,
      }).start();
    }
  } catch (err) {
    console.error(
      `[engineer-worker] "${source}" source failed — is LMU running with the plugin?`,
      err,
    );
  }
})();
