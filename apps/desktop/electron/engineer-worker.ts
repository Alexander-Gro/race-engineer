import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import { createSyntheticEngineerCore } from '../src/host';

/**
 * Engineer Core worker (build-plan T6.1) — runs in the Electron utility process so the 60 Hz
 * tick pipeline stays **off the UI thread**. It drives the offline synthetic source (so the app
 * shows live values with no game) and `postMessage`s throttled snapshots to the main process,
 * which forwards them to the renderer.
 *
 * Going live = swapping the source inside `createSyntheticEngineerCore` for the LMU adapter +
 * normalizer. Read-only/advisory: the worker only reads telemetry and emits snapshots.
 */
const transport = (snapshot: EngineerSnapshot): void => {
  process.parentPort.postMessage(snapshot);
};

const core = createSyntheticEngineerCore(transport, { snapshotHz: 12 });
void core.start();
