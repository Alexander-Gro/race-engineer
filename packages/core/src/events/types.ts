import type { EngineerEvent, RaceState } from '../schema';

/**
 * Event Detector contracts (docs/01 §Event Detector, docs/04 §Events). Rules are pure
 * functions of (previous, current) `RaceState`; the framework ({@link EventDetector}) owns
 * debounce/cooldown/dedupe and stamps each emitted event with an id + tick.
 */

/** What a rule returns: an event without the framework-assigned `id`/`tick`. */
export type CandidateEvent = Omit<EngineerEvent, 'id' | 'tick'>;

export interface DetectionContext {
  /** The previous tick's state, or null on the first tick. */
  prev: RaceState | null;
  curr: RaceState;
}

/** A single detection rule. Should be pure and allocation-light (it runs every tick). */
export interface EventRule {
  readonly name: string;
  detect(ctx: DetectionContext): CandidateEvent[];
}
