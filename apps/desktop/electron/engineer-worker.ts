import type { EngineerEvent } from '@race-engineer/core';
import type { SnapshotTransport } from '@race-engineer/engineer-core';
import { AskResponder, type AskRequestMessage, type WorkerMessage } from '../src/ask';
import { createSyntheticEngineerCore } from '../src/host';

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

// Renderer questions arrive (relayed by main) on the parent port; answer from the latest snapshot.
process.parentPort.on('message', (event: { data: AskRequestMessage }): void => {
  const msg = event.data;
  if (msg?.type === 'ask') {
    const reply: WorkerMessage = {
      type: 'ask-reply',
      id: msg.id,
      answer: responder.answer(msg.question),
    };
    process.parentPort.postMessage(reply);
  }
});

void (async (): Promise<void> => {
  const source = process.env['ENGINEER_SOURCE'] === 'lmu' ? 'lmu' : 'synthetic';

  // Proactive voice preview — opt-in, free/offline, silent until T4.5 wires a real audio sink.
  const voice =
    process.env['ENGINEER_VOICE'] === '1'
      ? await (await import('./worker-voice')).createWorkerVoice()
      : null;

  const transport: SnapshotTransport = (snapshot): void => {
    responder.update(snapshot);
    voice?.onSnapshot(snapshot);
    process.parentPort.postMessage({ type: 'snapshot', snapshot } satisfies WorkerMessage);
  };

  const onEvent = voice
    ? (events: readonly EngineerEvent[]): void => {
        void voice.routeEvents(events).then((outcomes) => {
          for (const o of outcomes) {
            const detail = o.kind === 'skipped' ? o.reason : `priority ${o.priority}`;
            console.log(`[voice] ${o.event.type} → ${o.kind} (${detail})`);
          }
        });
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
