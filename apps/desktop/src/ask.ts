import { askEngineer, type RaceContext } from '@race-engineer/ai';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';

/**
 * The free/no-key "ask the engineer" glue for the desktop app (Track A — "it answers you"). It
 * bridges the Core's {@link EngineerSnapshot} to the AI layer's {@link RaceContext} and answers a
 * typed question via template mode (docs/15) — no LLM, no key, no game write path.
 *
 * This lives in `src/` (not the Electron entry) so it stays unit-testable with no Electron and no
 * game, exactly like `./host`. The Electron worker (`../electron/engineer-worker`) holds an
 * {@link AskResponder}, feeds it each snapshot, and answers ask-requests relayed from the renderer.
 * The voice radio loop (next) reuses the same snapshot→context bridge when it moves into the worker.
 */

/** Map a Core snapshot to the read-only AI context (raceState + the live strategy plans). */
export const snapshotToRaceContext = (snapshot: EngineerSnapshot): RaceContext => ({
  raceState: snapshot.raceState,
  fuelPlan: snapshot.strategy?.fuelPlan ?? null,
  stintPlan: snapshot.strategy?.stintPlan ?? null,
});

/** Shown until the first snapshot arrives, so an early question never reads a null context. */
export const NO_TELEMETRY_ANSWER =
  "I'm not reading any telemetry yet — once a session is live, ask me again.";

/**
 * Holds the latest snapshot and answers text questions from it. A tiny stateful holder so the worker
 * can answer a request against the freshest context (not the context at subscribe time).
 */
export class AskResponder {
  #latest: EngineerSnapshot | null = null;

  /** Feed every snapshot in (the worker calls this from the snapshot transport). */
  update(snapshot: EngineerSnapshot): void {
    this.#latest = snapshot;
  }

  /** Answer a question against the latest snapshot, or guide the driver if none has arrived yet. */
  answer(question: string): string {
    if (this.#latest === null) return NO_TELEMETRY_ANSWER;
    return askEngineer(question, snapshotToRaceContext(this.#latest));
  }
}

/**
 * Worker → main messages over the Electron utility-process channel. Tagged so `main` can dispatch
 * snapshots to the renderer and correlate ask-replies. Kept here so both Electron entries share one
 * type. (Plain data — no Electron/Node types — so this file typechecks under the src-only config.)
 */
export type WorkerMessage =
  | { type: 'snapshot'; snapshot: EngineerSnapshot }
  | { type: 'ask-reply'; id: number; answer: string };

/** Main → worker messages: a renderer ask relayed to the Core, correlated by `id`. */
export interface AskRequestMessage {
  type: 'ask';
  id: number;
  question: string;
}
