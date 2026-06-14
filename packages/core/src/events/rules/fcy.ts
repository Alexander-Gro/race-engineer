import type { RaceState, Tier } from '../../schema';
import type { EventRule } from '../types';

/**
 * Safety-car / full-course-yellow onset → `fcy_opportunity` (docs/05 §7). A stop is much cheaper
 * under caution (the field is slowed/bunched), so the engineer should re-evaluate pitting the moment
 * a caution drops. This rule is the **trigger**: it edge-detects green→caution and emits one Tier-2
 * (conversational) event per caution period. The cheap-stop *decision* — how much you save and whether
 * you're due — is `evaluateFcyStop` in `@race-engineer/strategy` (the LLM phrases that; `strategy`
 * can't be imported here as `core` is its dependency, not the reverse).
 *
 * Pure and allocation-light (runs every tick); edge-triggered like the spotter's `clear`, with the
 * {@link EventDetector}'s cooldown guarding against flag flicker. Read-only/advisory.
 */

export interface FcyOptions {
  /** Delivery tier. Default 2 (conversational — the engineer talks the driver through it). */
  tier?: Tier;
  /** Voice-queue priority. Default 40 (strategic; below safety reflex/awareness calls). */
  priority?: number;
  /** Suppress a re-fire within this window if the caution flag flickers (ms). Default 30000. */
  cooldownMs?: number;
}

interface ResolvedOptions {
  tier: Tier;
  priority: number;
  cooldownMs: number;
}

const resolve = (o: FcyOptions): ResolvedOptions => ({
  tier: o.tier ?? 2,
  priority: o.priority ?? 40,
  cooldownMs: o.cooldownMs ?? 30_000,
});

/** Is the field under a full-course caution (FCY or safety car)? */
export const isUnderCaution = (state: RaceState): boolean =>
  state.flags.global === 'fcy' || state.flags.global === 'safetyCar';

/**
 * Build the FCY/SC opportunism rule. Fires on the green→caution edge (or on the first tick if the
 * session opens under caution), not while the caution sustains, and not while the player is already
 * in the pit lane (no opportunity to flag — they're already stopping).
 */
export const fcyRule = (options: FcyOptions = {}): EventRule => {
  const o = resolve(options);
  return {
    name: 'fcy',
    detect({ prev, curr }) {
      const now = isUnderCaution(curr);
      const before = prev ? isUnderCaution(prev) : false;
      if (!now || before || curr.player.pit.inPitLane) return [];
      return [
        {
          type: 'fcy_opportunity',
          tier: o.tier,
          priority: o.priority,
          payload: {
            caution: curr.flags.global,
            gamePhase: curr.session.phase,
            playerStops: curr.player.pit.stops,
          },
          dedupeKey: 'fcy_opportunity',
          cooldownMs: o.cooldownMs,
        },
      ];
    },
  };
};
