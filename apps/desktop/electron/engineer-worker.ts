import { selectLlmProvider } from '@race-engineer/ai';
import type { EngineerEvent } from '@race-engineer/core';
import type { SnapshotTransport } from '@race-engineer/engineer-core';
import type { ProactivityLevel } from '@race-engineer/radio';
import { AskResponder, type MainToWorkerMessage, type WorkerMessage } from '../src/ask';
import { createSyntheticEngineerCore } from '../src/host';
import type { EngineerVoice } from '../src/voice-engine';

/**
 * Engineer Core worker (build-plan T6.1 + Track A voice path) — runs in the Electron utility process
 * so the tick pipeline stays **off the UI thread**. It `postMessage`s throttled snapshots to the
 * main process (forwarded to the renderer), answers **text questions** via the free/no-key
 * {@link AskResponder} (template mode — docs/15), and — when enabled — routes detected events to the
 * **proactive voice layer**. The AI brain stays off the UI thread alongside the pipeline.
 * Read-only/advisory: the worker only reads telemetry and phrases output; no path to the game.
 *
 * Source is chosen by `ENGINEER_SOURCE`:
 *   - default → the offline **synthetic** scenario (paced + looped) so the app shows live values
 *     with no game (`pnpm dev`);
 *   - `lmu` → the real **shared-memory** source on the Windows rig (`pnpm dev:lmu`). The LMU wiring
 *     (koffi, Windows-only native) is **dynamically imported only when selected**, so the synthetic
 *     demo never loads koffi. Until LMU is in a session it emits nothing — the dashboard waits.
 *
 * `ENGINEER_VOICE=1` enables the proactive voice preview (free/offline; **audio is silent until the
 * real OS sink lands in T4.5/T10.1** — routed call-outs are logged). Off by default so the dashboard
 * demo is untouched, and the voice/radio/ai graph is **dynamically imported only when enabled**.
 */
const responder = new AskResponder();
// The proactive voice (built in the IIFE when ENGINEER_VOICE=1) + the latest configured chattiness.
// `configure` may arrive before the voice is built (it's posted on `ready`), so hold the level and
// apply it once the voice exists.
let voice: EngineerVoice | null = null;
let proactivity: ProactivityLevel = 'normal';

// Main-relayed messages on the parent port: text questions, and the engineer-route config.
process.parentPort.on('message', (event: { data: MainToWorkerMessage }): void => {
  const msg = event.data;
  if (msg?.type === 'ask') {
    void responder
      .answer(msg.question)
      .then((answer) => {
        process.parentPort.postMessage({
          type: 'ask-reply',
          id: msg.id,
          answer,
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
    voice?.setProactivity(proactivity); // applied here, or after the voice is built (see below)
  }
});

// Tell main we're listening, so it sends the engineer-route config (avoids a fork/postMessage race).
process.parentPort.postMessage({ type: 'ready' } satisfies WorkerMessage);

void (async (): Promise<void> => {
  const source = process.env['ENGINEER_SOURCE'] === 'lmu' ? 'lmu' : 'synthetic';

  // Proactive voice preview — opt-in, free/offline, silent until T4.5 wires a real audio sink.
  voice =
    process.env['ENGINEER_VOICE'] === '1'
      ? await (await import('./worker-voice')).createWorkerVoice()
      : null;
  voice?.setProactivity(proactivity); // apply any config that arrived before the voice was built
  const activeVoice = voice; // a const so the closures below narrow `null` away (configure uses `voice`)

  const transport: SnapshotTransport = (snapshot): void => {
    responder.update(snapshot);
    activeVoice?.onSnapshot(snapshot);
    process.parentPort.postMessage({ type: 'snapshot', snapshot } satisfies WorkerMessage);
  };

  const onEvent = activeVoice
    ? (events: readonly EngineerEvent[]): void => {
        // Fire-and-forget off the tick thread; a synth/TTS failure must never crash the worker
        // (docs/16 §1 "never crash; the radio is the core feature") — log and move on.
        void activeVoice
          .routeEvents(events)
          .then((outcomes) => {
            for (const o of outcomes) {
              const detail = o.kind === 'skipped' ? o.reason : `priority ${o.priority}`;
              console.log(`[voice] ${o.event.type} → ${o.kind} (${detail})`);
            }
          })
          .catch((err) => console.error('[voice] proactive routing failed', err));
      }
    : undefined;

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
