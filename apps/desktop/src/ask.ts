import {
  askEngineer,
  checkSpokenNumbers,
  runRadioTurn,
  type LlmProvider,
  type LlmRouteConfig,
  type RaceContext,
} from '@race-engineer/ai';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import type { ProactivityLevel } from '@race-engineer/radio';
import type { AudioOutMessage } from './audio-bridge';

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
 * Holds the latest snapshot and answers text questions from it against the freshest context. Free
 * template mode by default (no key); when the user has configured an LLM "engineer" (T6.3 settings →
 * {@link AskResponder.setProvider}), it routes through the read-only tool loop instead — but only
 * speaks the LLM's answer if **every number traces to a tool result** (hallucination guard, docs/06);
 * otherwise it falls back to the grounded template answer. Any provider error also falls back, so the
 * driver is never left hanging (docs/15 §fallback). Read-only/advisory throughout.
 */
export class AskResponder {
  #latest: EngineerSnapshot | null = null;
  #provider: LlmProvider | null = null;

  /** Feed every snapshot in (the worker calls this from the snapshot transport). */
  update(snapshot: EngineerSnapshot): void {
    this.#latest = snapshot;
  }

  /** Set the configured LLM engineer, or null for free template mode. */
  setProvider(provider: LlmProvider | null): void {
    this.#provider = provider;
  }

  /** Answer a question against the latest snapshot, or guide the driver if none has arrived yet. */
  async answer(question: string): Promise<string> {
    if (this.#latest === null) return NO_TELEMETRY_ANSWER;
    const ctx = snapshotToRaceContext(this.#latest);
    if (this.#provider === null) return askEngineer(question, ctx);
    try {
      const result = await runRadioTurn({
        provider: this.#provider,
        context: () => ctx,
        userMessage: question,
      });
      const text = result.text.trim();
      // Speak the LLM only if grounded; otherwise the template answer (numbers straight from tools).
      if (text && checkSpokenNumbers(result).grounded) return text;
      return askEngineer(question, ctx);
    } catch {
      return askEngineer(question, ctx); // provider/network failure → grounded fallback, never hang
    }
  }
}

/**
 * Worker → main messages over the Electron utility-process channel. Tagged so `main` can dispatch
 * snapshots to the renderer, correlate ask-replies, and learn when the worker is ready for its
 * provider config. Kept here so both Electron entries share one type. (Plain data — no Electron/Node
 * types — so this file typechecks under the src-only config.)
 */
export type WorkerMessage =
  | { type: 'snapshot'; snapshot: EngineerSnapshot }
  | { type: 'ask-reply'; id: number; answer: string }
  | { type: 'ready' }
  // The voice queue (in the worker) asks the renderer to play/stop a clip — main relays it.
  | { type: 'audio'; audio: AudioOutMessage };

/** A renderer ask relayed to the Core, correlated by `id`. */
export interface AskRequestMessage {
  type: 'ask';
  id: number;
  question: string;
}

/** Main → worker: apply the saved engineer config — the LLM route (provider + key, or template)
 * and the proactivity level. Pushed on the worker's `ready` and after every settings/secret change. */
export interface ConfigureMessage {
  type: 'configure';
  llmRoute: LlmRouteConfig;
  proactivity: ProactivityLevel;
}

/** Main → worker: the renderer reported a clip finished playing (drains the voice queue). */
export interface AudioEndedRelayMessage {
  type: 'audio-ended';
  pid: number;
}

/** Everything main can send the worker. */
export type MainToWorkerMessage = AskRequestMessage | ConfigureMessage | AudioEndedRelayMessage;
