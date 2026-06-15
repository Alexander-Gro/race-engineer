import type { RaceState } from '@race-engineer/core';

/**
 * Advice verification from telemetry (build-plan T8.4, docs/08 §3 — the `AdviceVerifier`). The engineer
 * recommends a bounded aid change ("you're on TC 3 — go to 5"); **the driver makes it themselves**, and
 * the app then *reads telemetry back* to confirm it happened — "good, that's it" — or notices it didn't.
 *
 * This is the deterministic core: a pure read of the current aid value plus a small state machine that
 * watches the canonical `RaceState` stream and resolves to `applied` / `unchanged` / `timeout`. It is
 * **read-only/advisory** — it only observes telemetry to give feedback; it never writes the aid (CLAUDE.md
 * rule 5; there is no `ControlWriter`). And it does no arithmetic the LLM would otherwise invent — the
 * coaching loop (T8.3) and the radio layer phrase this result; they don't recompute it (rule 1).
 *
 * Time comes from the frame's `monotonicMs`, so the watcher is a pure function of the telemetry stream —
 * deterministic and replay-safe, no wall clock. The aid *values* themselves are populated by the live
 * shared-memory/REST reads (S3, docs/03); until those land for a given aid, `readAidParameter` returns
 * `null` and the watch resolves to `timeout` (it cannot confirm what it cannot read).
 */

/** The readable driver aids the engineer advises on and verifies (docs/08 §2). */
export type AidParameter = 'tc' | 'abs' | 'brakeBias' | 'engineMap';

/** Read the current numeric value of an advised aid, or `null` when the game doesn't expose it. */
export const readAidParameter = (state: RaceState, parameter: AidParameter): number | null => {
  const player = state.player;
  switch (parameter) {
    case 'tc':
      return player.aids.tc?.value ?? null;
    case 'abs':
      return player.aids.abs?.value ?? null;
    case 'brakeBias':
      return player.aids.brakeBias.frontPct;
    case 'engineMap':
      return player.engine.map;
    default: {
      const unknown: never = parameter;
      throw new Error(`unknown aid parameter: ${String(unknown)}`);
    }
  }
};

/**
 * A change the engineer recommended. The driver applies it; the app verifies from telemetry (docs/08 §3).
 * Give a concrete `to` (e.g. "TC to 5") and/or a `direction` (e.g. "bias back" ⇒ frontPct `decrease`) —
 * "back/forward/up/down" are translated to a numeric direction by the *advice*, so the verifier stays
 * purely numeric.
 */
export interface ProposedChange {
  parameter: AidParameter;
  /** The baseline value when the advice was given. */
  from: number;
  /** The recommended target value, when a specific number was advised. */
  to?: number;
  /** The advised direction of the numeric value, when no exact target. */
  direction?: 'increase' | 'decrease';
  /** Match tolerance for `to` (default 0 for discrete levels; set a small value for a float like brake-bias %). */
  toleranceAbs?: number;
}

export type AdviceStatus = 'watching' | 'applied' | 'unchanged' | 'timeout';

/** How long to wait for the driver to act before giving up on confirming the change. */
export const DEFAULT_ADVICE_TIMEOUT_MS = 30_000;

/** Whether `value` satisfies the advised change: at (within tolerance of) the target, or moved as advised. */
export const changeSatisfied = (change: ProposedChange, value: number): boolean => {
  if (change.to !== undefined) {
    return Math.abs(value - change.to) <= (change.toleranceAbs ?? 0);
  }
  if (change.direction === 'increase') return value > change.from;
  if (change.direction === 'decrease') return value < change.from;
  return false; // no target and no direction — nothing to verify against
};

/**
 * Classify a single observation. `applied` the moment the value satisfies the advice; once the window
 * elapses, `unchanged` if still exactly at the baseline (the driver didn't act) or `timeout` if it moved
 * but not as advised — or couldn't be read (`null`). Otherwise still `watching`.
 */
export const classifyAdvice = (
  change: ProposedChange,
  value: number | null,
  elapsedMs: number,
  timeoutMs: number,
): AdviceStatus => {
  if (value !== null && changeSatisfied(change, value)) return 'applied';
  if (elapsedMs >= timeoutMs) return value === change.from ? 'unchanged' : 'timeout';
  return 'watching';
};

export interface AdviceWatcherOptions {
  /** Window to confirm the change in (ms of telemetry time). Default {@link DEFAULT_ADVICE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Watches the `RaceState` stream for a {@link ProposedChange}, resolving once. Feed each tick to
 * {@link AdviceWatcher.update}; the first observed frame stamps the start, and elapsed time is measured
 * from the frame's `monotonicMs`. The status is **sticky** once terminal — the change was made (or not);
 * a later revert is a new advice cycle, not this one un-resolving.
 */
export class AdviceWatcher {
  readonly #change: ProposedChange;
  readonly #timeoutMs: number;
  #startMs: number | null = null;
  #status: AdviceStatus = 'watching';

  constructor(change: ProposedChange, options: AdviceWatcherOptions = {}) {
    this.#change = change;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_ADVICE_TIMEOUT_MS;
  }

  get status(): AdviceStatus {
    return this.#status;
  }

  /** Feed the latest state; returns the (possibly now-terminal) status. No-op once resolved. */
  update(state: RaceState): AdviceStatus {
    if (this.#status !== 'watching') return this.#status;
    if (this.#startMs === null) this.#startMs = state.monotonicMs;
    const value = readAidParameter(state, this.#change.parameter);
    const elapsedMs = state.monotonicMs - this.#startMs;
    this.#status = classifyAdvice(this.#change, value, elapsedMs, this.#timeoutMs);
    return this.#status;
  }
}
