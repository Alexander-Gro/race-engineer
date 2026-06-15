import type { EngineerEvent, FuelPlan, RaceState, StintPlan } from '../schema';

/**
 * Event Detector contracts (docs/01 §Event Detector, docs/04 §Events). Rules are pure
 * functions of (previous, current) `RaceState`; the framework ({@link EventDetector}) owns
 * debounce/cooldown/dedupe and stamps each emitted event with an id + tick.
 */

/** What a rule returns: an event without the framework-assigned `id`/`tick`. */
export type CandidateEvent = Omit<EngineerEvent, 'id' | 'tick'>;

/** The derived strategy a strategy-aware rule may read (T7.9); both are core types. */
export interface DetectionStrategy {
  fuelPlan: FuelPlan | null;
  stintPlan: StintPlan | null;
}

export interface DetectionContext {
  /** The previous tick's state, or null on the first tick. */
  prev: RaceState | null;
  curr: RaceState;
  /**
   * The latest derived strategy (fuel/stint plans), for strategy-aware rules (T7.9 pit-window
   * call-outs). Absent for pure-telemetry rules and when no plan has been computed yet. Supplied by
   * the always-on strategy engine; it is the snapshot-cadence plan (a frame or two stale at most),
   * which is fine for lap-granular call-outs.
   */
  strategy?: DetectionStrategy | undefined;
}

/** A single detection rule. Should be pure and allocation-light (it runs every tick). */
export interface EventRule {
  readonly name: string;
  detect(ctx: DetectionContext): CandidateEvent[];
}
