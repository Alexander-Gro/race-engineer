import type { EngineerEvent, RaceState } from '../schema';
import type { EventRule } from './types';

/**
 * The Event Detector framework (docs/04 §Events). It runs a set of rules over consecutive
 * `RaceState` ticks and emits `EngineerEvent`s, applying **cooldown + dedupe** so the
 * engineer is not chatty: a candidate carrying `cooldownMs` is suppressed if the same
 * `dedupeKey` (or, absent one, its `type`) fired within `cooldownMs` (measured on the app
 * clock `monotonicMs`). Suppression is **per dedupe-key**, so a multi-threshold rule (e.g.
 * `fuel_low` at 4 then 2 laps) cools each threshold down independently. Edge-triggered rules
 * (e.g. `lap_completed`) carry no cooldown and fire whenever their rule returns them.
 *
 * Pure and deterministic given the tick sequence; stateful only across `process` calls.
 * One instance per session; call `reset()` to clear between sessions.
 */
export class EventDetector {
  readonly #rules: readonly EventRule[];
  #prev: RaceState | null = null;
  readonly #lastEmitMs = new Map<string, number>();
  #seq = 0;

  constructor(rules: readonly EventRule[]) {
    this.#rules = rules;
  }

  process(curr: RaceState): EngineerEvent[] {
    const ctx = { prev: this.#prev, curr };
    const emitted: EngineerEvent[] = [];

    for (const rule of this.#rules) {
      for (const candidate of rule.detect(ctx)) {
        const key = candidate.dedupeKey ?? candidate.type;
        if (candidate.cooldownMs !== undefined) {
          const last = this.#lastEmitMs.get(key);
          if (last !== undefined && curr.monotonicMs - last < candidate.cooldownMs) {
            continue; // still cooling down — suppress the repeat
          }
          this.#lastEmitMs.set(key, curr.monotonicMs);
        }
        emitted.push({ ...candidate, id: `${candidate.type}:${this.#seq}`, tick: curr.tick });
        this.#seq += 1;
      }
    }

    this.#prev = curr;
    return emitted;
  }

  /** Clear all history (previous tick, cooldown timers, id counter). */
  reset(): void {
    this.#prev = null;
    this.#lastEmitMs.clear();
    this.#seq = 0;
  }
}
