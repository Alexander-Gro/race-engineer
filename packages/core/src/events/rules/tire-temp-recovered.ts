import type { Tier } from '../../schema';
import type { CandidateEvent, EventRule } from '../types';
import { DEFAULT_TIRE_TEMP_THRESHOLDS, representativeC, WHEELS } from './tire-temp';

/**
 * `tire_temp_recovered` — fires the moment the player's tyres come back **into** the operating
 * window after at least one was cold (the cold → in-window edge), during the race. This is the
 * second half of the start-of-stint arc: {@link tireTempRule} flags the cold tyres at the start (the
 * engineer reframes that as "they'll be cold for a couple of laps, ease in"), and this rule gives
 * the engineer the trigger for the promised follow-up ("they're up to temp now — you can lean on
 * them"). Edge-triggered (not level), so it's one call as they cross in, not a repeat while warm.
 *
 * It only *flags the moment* — like every rule, the engineer decides whether and how to say it
 * (CLAUDE.md vision); the words and the actual temps come from the AI's read-only tools, not here.
 * Suppressed in the pit lane and outside the race phase. Read-only/advisory. docs/04 §Events.
 */
export interface TireTempRecoveredOptions {
  /** Below this representative °C a tyre reads cold. Defaults to the {@link tireTempRule} window. */
  minC?: number;
  /** Above this representative °C a tyre reads overheating. Defaults to the same window. */
  maxC?: number;
  tier?: Tier;
  priority?: number;
  cooldownMs?: number;
}

export const tireTempRecoveredRule = (options: TireTempRecoveredOptions = {}): EventRule => {
  const minC = options.minC ?? DEFAULT_TIRE_TEMP_THRESHOLDS.minC;
  const maxC = options.maxC ?? DEFAULT_TIRE_TEMP_THRESHOLDS.maxC;
  const tier = options.tier ?? DEFAULT_TIRE_TEMP_THRESHOLDS.tier;
  const priority = options.priority ?? DEFAULT_TIRE_TEMP_THRESHOLDS.priority;
  const cooldownMs = options.cooldownMs ?? DEFAULT_TIRE_TEMP_THRESHOLDS.cooldownMs;

  const finiteTemps = (tires: { tempC: Parameters<typeof representativeC>[0] }[]): number[] =>
    tires
      .slice(0, 4)
      .map((tire) => representativeC(tire.tempC))
      .filter((c) => Number.isFinite(c));

  return {
    name: 'tire_temp_recovered',
    detect({ prev, curr }) {
      if (prev === null) return [];
      // Only meaningful in the race; cold-then-warm in the pits/garage isn't a driver call.
      if (curr.session.phase !== 'race') return [];
      if (curr.player.pit.inPitLane) return [];

      const prevTemps = finiteTemps(prev.player.tires);
      const currTemps = finiteTemps(curr.player.tires);
      if (prevTemps.length === 0 || currTemps.length < 4) return [];

      const wasCold = prevTemps.some((c) => c < minC);
      const nowAllInWindow = currTemps.every((c) => c >= minC && c <= maxC);
      if (!wasCold || !nowAllInWindow) return [];

      const event: CandidateEvent = {
        type: 'tire_temp_recovered',
        tier,
        priority,
        payload: {
          window: { minC, maxC },
          corners: WHEELS.slice(0, currTemps.length),
        },
        dedupeKey: 'tire_temp_recovered',
        cooldownMs,
      };
      return [event];
    },
  };
};
