import {
  EngineerEventSchema,
  EventDetector,
  type EngineerEvent,
  type EventRule,
  type EventType,
  type RaceState,
} from '@race-engineer/core';
import { StrategyEngine, defaultEventRules } from '@race-engineer/engineer-core';

/**
 * Event-correctness eval (docs/10 Phase-2 acceptance, docs/04 §Events): run the **same
 * {@link EventDetector} + {@link defaultEventRules} the app runs** over a recorded `RaceState`
 * stream (with the live strategy context fed in, so strategy-aware rules behave as in-app) and
 * check the emitted events for structural correctness on genuine telemetry:
 *
 *  - **Lap markers match the data**: exactly one `lap_completed` per lap-boundary transition.
 *  - **Well-formed**: every event validates against {@link EngineerEventSchema}, carries a finite
 *    `priority`, and has no NaN/∞ in its numeric payload (no fabricated/garbage figures).
 *  - **No event storm**: the cooldown/dedupe framework keeps per-tick output bounded (a rule that
 *    fired every tick would flood the radio — docs/04 §debounce).
 *
 * Read-only/advisory: detection only emits advisory events; nothing here writes to the game.
 */

export interface EventCorrectnessResult {
  totalEvents: number;
  countsByType: Partial<Record<EventType, number>>;
  /** Number of lap-boundary transitions (`lapsCompleted` increased) in the stream. */
  actualLapBoundaries: number;
  /** Number of `lap_completed` events emitted. */
  lapCompletedEvents: number;
  /** `lapCompletedEvents === actualLapBoundaries` — the lap marker tracks the data exactly. */
  lapMarkersMatch: boolean;
  /** Events that failed schema validation or carried a non-finite priority/payload number. */
  malformed: EngineerEvent[];
  /** True when no event is malformed. */
  allWellFormed: boolean;
  /** The most events emitted in any single tick (a storm-guard sanity metric). */
  maxEventsPerTick: number;
}

/** Recursively check that every numeric leaf in a payload is finite (no NaN/∞). */
const payloadNumbersFinite = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(payloadNumbersFinite);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).every(payloadNumbersFinite);
  }
  return true;
};

const isWellFormed = (event: EngineerEvent): boolean =>
  EngineerEventSchema.safeParse(event).success &&
  Number.isFinite(event.priority) &&
  payloadNumbersFinite(event.payload);

export const evalEventCorrectness = (
  frames: readonly RaceState[],
  rules: readonly EventRule[] = defaultEventRules(),
): EventCorrectnessResult => {
  const detector = new EventDetector(rules);
  // Feed the same always-on strategy the app feeds the detector, so strategy-aware rules (T7.9
  // pit-window call-outs) behave exactly as in-app rather than silently no-op'ing.
  const strategyEngine = new StrategyEngine();

  const all: EngineerEvent[] = [];
  const countsByType: Partial<Record<EventType, number>> = {};
  let actualLapBoundaries = 0;
  let maxEventsPerTick = 0;
  let prevLaps: number | null = null;

  for (const frame of frames) {
    if (prevLaps !== null && frame.player.lapsCompleted > prevLaps) actualLapBoundaries += 1;
    prevLaps = frame.player.lapsCompleted;

    strategyEngine.observe(frame);
    const events = detector.process(frame, strategyEngine.summary(frame));
    maxEventsPerTick = Math.max(maxEventsPerTick, events.length);
    for (const e of events) {
      all.push(e);
      countsByType[e.type] = (countsByType[e.type] ?? 0) + 1;
    }
  }

  const malformed = all.filter((e) => !isWellFormed(e));
  const lapCompletedEvents = countsByType['lap_completed'] ?? 0;

  return {
    totalEvents: all.length,
    countsByType,
    actualLapBoundaries,
    lapCompletedEvents,
    lapMarkersMatch: lapCompletedEvents === actualLapBoundaries,
    malformed,
    allWellFormed: malformed.length === 0,
    maxEventsPerTick,
  };
};
