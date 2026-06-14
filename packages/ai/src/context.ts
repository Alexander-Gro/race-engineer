import type { FuelPlan, RaceState, StintPlan } from '@race-engineer/core';

/**
 * The query-time snapshot the read-only tools read from (docs/06 §Context strategy). The
 * Engineer Core (T6.1) keeps this current — it owns the rolling history and runs the strategy
 * engine — and the AI layer only *reads* it. Keeping the AI package a pure consumer is what
 * lets it depend on `core` types alone (the LLM never computes; it phrases tool output).
 */
export interface RaceContext {
  raceState: RaceState;
  /** Latest fuel plan from the strategy engine, or null while consumption is still unknown. */
  fuelPlan: FuelPlan | null;
  /**
   * Latest stint plan from the strategy engine (T7.3), or null/absent until it has run. Optional so
   * existing callers stay valid; the Engineer Core fills it in alongside `fuelPlan` when ready.
   */
  stintPlan?: StintPlan | null;
}

/** A getter so tools snapshot the freshest context at call time, not turn-start. */
export type RaceContextProvider = () => RaceContext;
