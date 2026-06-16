import type { FuelPlan } from '@race-engineer/core';
import type { HandlingDiagnosis } from './handling';

/**
 * Integrated coaching (build-plan T8.3, docs/06 / docs/08 §3). The **cross-domain** layer: the
 * per-domain reads already exist — the handling diagnosis (T9.2) describes the balance, setup-advice
 * (T9.4) proposes bar/wing changes, the background strategist (T8.2) flags fuel/energy — so this links
 * them into a single corrective **driving** action, and only when domains *align* (so it adds insight,
 * not chatter). The flagship case: understeer **and** energy-limited → one lift earlier helps both.
 *
 * Pure/deterministic over the existing deterministic reads (CLAUDE.md rule 1 — no new math; it composes
 * `bindingConstraint` + balance `tendency`). Read-only/advisory: it coaches *driving*, never a setup or
 * game write (rule 5). The balance `tendency` it keys off is reliable from the representative tyre temps
 * even without 3-zone data, so notes carry the diagnosis `confidence01` for downstream hedging rather
 * than being hard-gated. Scope note: more links (brakes, traffic) are a follow-up.
 */

export type CoachingDomain = 'handling' | 'tyres' | 'energy' | 'fuel';

export interface CoachingNote {
  /** The driving change to make (the driver applies it on track). */
  focus: string;
  /** Why — names the domains it connects. */
  rationale: string;
  /** Which domains this note links (≥2 = a genuinely integrated insight). */
  links: CoachingDomain[];
  confidence01: number;
}

export interface CoachingInput {
  handling: HandlingDiagnosis;
  /** Latest fuel/energy plan (for the binding constraint), or null when not yet known. */
  fuelPlan: FuelPlan | null;
}

/**
 * Produce ordered integrated-coaching notes from the cross-domain reads, or `[]` when nothing aligns
 * (then the per-domain answers/strategist stand alone — no duplication here). The energy↔handling
 * win-win is surfaced first.
 */
export const integratedCoaching = ({ handling, fuelPlan }: CoachingInput): CoachingNote[] => {
  const tendency = handling.balance.tendency;
  const conf = handling.confidence01;
  const energyLimited = fuelPlan?.bindingConstraint === 'energy';
  const notes: CoachingNote[] = [];

  if (tendency === 'understeer') {
    if (energyLimited) {
      notes.push({
        focus: 'Lift a touch earlier into the quick corners.',
        rationale:
          "you're energy-limited and the fronts are working hard — lifting saves energy and eases the understeer",
        links: ['energy', 'handling', 'tyres'],
        confidence01: conf,
      });
    } else {
      notes.push({
        focus: 'Brake a little earlier and ease the entry.',
        rationale:
          'the fronts are running hotter than the rears — that push is understeer; a smoother entry brings them back',
        links: ['handling', 'tyres'],
        confidence01: conf,
      });
    }
  } else if (tendency === 'oversteer') {
    notes.push({
      focus: 'Feed the throttle in more gently on exit.',
      rationale: "the rears are running hotter — they're stepping out under power",
      links: ['handling', 'tyres'],
      confidence01: conf,
    });
    if (energyLimited) {
      notes.push({
        focus: 'Short-shift on exit too.',
        rationale: "you're energy-limited, and lower revs out of the corner also calms the rear",
        links: ['energy', 'handling'],
        confidence01: conf,
      });
    }
  }

  return notes;
};
