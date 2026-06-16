import type { FuelPlan, Tier } from '../../schema';
import type { CandidateEvent, EventRule } from '../types';

/**
 * Background strategist (build-plan T8.2, docs/06 §Proactive). The proactive "thinking-ahead" layer:
 * it volunteers the single most useful **forward-looking** strategy line — distinct from the reflex
 * rules (`fuel_low`/`energy_low` fire on *low absolute* thresholds; the spotter/traffic rules are
 * positional). The strategist instead watches whether you're **on the plan's pace** and, when you've
 * fallen behind enough that you must save to reach the next stop, says so — and which resource binds.
 *
 * Realised as a salience-gated event rule over the always-on detector (the detector *is* the loop):
 * it emits a Tier-2 `strategy_update` (a declared event type that previously had no producer), deduped
 * per headline so it speaks **on change** and is then rate-limited by cooldown — not per-lap chatter.
 * Silent when there's no plan, while pitting, or when nothing needs saying. Reads the numbers the
 * strategy engine already computed (CLAUDE.md rule 1 — no math here); read-only/advisory (rule 5).
 *
 * Scope note: richer headlines (undercut windows, traffic-cost) need per-rival tyre-gain/pit-loss
 * context the Core doesn't expose yet (same gap as `evaluate_undercut`) — a follow-up.
 */

export interface StrategistOptions {
  tier?: Tier;
  priority?: number;
  /** How often the *same* headline may repeat while it persists (default 3 min). */
  cooldownMs?: number;
  /**
   * Confidence floor (docs/05 §8 "trustworthy or silent"): stay silent until the plan is trustworthy,
   * so we never volunteer a save target off a one- or two-lap noisy estimate. Matches the sibling
   * `strategyCalloutRule` default (0.4).
   */
  minConfidence01?: number;
}

type Headline =
  | { kind: 'energy-save'; binding: 'energy'; savePerLapPct: number }
  | { kind: 'fuel-save'; binding: 'fuel' | 'energy' | null; savePerLapLiters: number };

/** The single most salient forward-looking headline from the plan, or null when nothing needs saying. */
const pickHeadline = (fp: FuelPlan): Headline | null => {
  // Energy-limited and you must save VE to reach the stop — the LMU-specific case, checked first.
  if (fp.bindingConstraint === 'energy' && fp.energySaveTargetPerLap01 !== null) {
    return {
      kind: 'energy-save',
      binding: 'energy',
      savePerLapPct: fp.energySaveTargetPerLap01 * 100,
    };
  }
  // Off the fuel plan — must save litres to reach the stop.
  if (fp.fuelSaveTargetLitersPerLap !== null) {
    return {
      kind: 'fuel-save',
      binding: fp.bindingConstraint,
      savePerLapLiters: fp.fuelSaveTargetLitersPerLap,
    };
  }
  return null; // on plan / nothing to volunteer
};

export const strategistRule = (options: StrategistOptions = {}): EventRule => {
  const tier = options.tier ?? 2; // conversational heads-up
  const priority = options.priority ?? 4;
  const cooldownMs = options.cooldownMs ?? 180_000;
  const minConfidence01 = options.minConfidence01 ?? 0.4;
  return {
    name: 'strategist',
    detect({ curr, strategy }) {
      const fp = strategy?.fuelPlan ?? null;
      if (!fp) return [];
      if (curr.player.pit.inPitLane) return []; // don't volunteer strategy mid-stop
      // Trustworthy or silent: don't volunteer a save target off a noisy early-stint plan.
      if (fp.confidence01 < minConfidence01) return [];

      const headline = pickHeadline(fp);
      if (!headline) return [];

      const event: CandidateEvent = {
        type: 'strategy_update',
        tier,
        priority,
        // Carry confidence01 so downstream gating/phrasing (T8.5) can hedge a borderline plan.
        payload: { ...headline, confidence01: fp.confidence01 },
        // Speak on a change of headline (kind or binding); same headline is cooldown-limited.
        dedupeKey: `strategy_update:${headline.kind}:${headline.binding ?? ''}`,
        cooldownMs,
      };
      return [event];
    },
  };
};
