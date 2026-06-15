import type { SnapshotTransport } from '@race-engineer/engineer-core';
import { AskResponder, type AskRequestMessage, type WorkerMessage } from '../src/ask';
import { createSyntheticEngineerCore } from '../src/host';

/**
 * Engineer Core worker (build-plan T6.1) — runs in the Electron utility process so the tick
 * pipeline stays **off the UI thread**. It `postMessage`s throttled snapshots to the main process,
 * which forwards them to the renderer. It also answers **text questions** relayed from the renderer
 * via the free/no-key {@link AskResponder} (template mode — docs/15), keeping the AI brain off the
 * UI thread alongside the pipeline. Read-only/advisory: the worker only reads telemetry and phrases
 * tool output; there is no path to the game.
 *
 * Source is chosen by the `ENGINEER_SOURCE` env var:
 *   - default → the offline **synthetic** scenario (paced + looped) so the app shows live values
 *     with no game (`pnpm dev`);
 *   - `lmu` → the real **shared-memory** source on the Windows rig (`pnpm dev:lmu`). The LMU wiring
 *     (koffi, Windows-only native) is **dynamically imported only when selected**, so the synthetic
 *     demo never loads koffi. Until LMU is in a session it emits nothing — the dashboard waits.
 */
const responder = new AskResponder();

const transport: SnapshotTransport = (snapshot): void => {
  responder.update(snapshot);
  process.parentPort.postMessage({ type: 'snapshot', snapshot } satisfies WorkerMessage);
};

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
  try {
    if (source === 'lmu') {
      // eslint-disable-next-line no-console
      console.log(
        '[engineer-worker] source=lmu — reading shared memory (waiting for an LMU session)',
      );
      const { createLmuEngineerCore } = await import('../src/lmu-host');
      await createLmuEngineerCore(transport, { snapshotHz: 12 }).start();
    } else {
      // Pace + loop the synthetic source so the dashboard shows continuous, evolving values (a real
      // game emits in real time; the finite scenario would otherwise flash past before the UI subscribes).
      await createSyntheticEngineerCore(transport, {
        snapshotHz: 12,
        frameIntervalMs: 150,
        loop: true,
      }).start();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[engineer-worker] "${source}" source failed — is LMU running with the plugin?`,
      err,
    );
  }
})();
