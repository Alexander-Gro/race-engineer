import type { HandlingDiagnosis } from './handling';

/**
 * Setup-change *advice* from the telemetry handling diagnosis (build-plan T9.4, docs/08 §3 / docs/06
 * `propose_setup_change`). Maps the deterministic handling read (axle balance + per-corner camber /
 * pressure from tyre temps, T9.2) to **directional, relative** suggestions in conventional tyre/setup
 * theory — "soften the front bar a click or two", "lower the front-left pressure a little".
 *
 * **Advice only — the app never changes the setup (CLAUDE.md rule 5).** Every suggestion is a change
 * the *driver* makes in the garage; there is no write path. Directions are conventional (rig-agnostic);
 * the `.svm` can't yield absolute clicks/° (docs/03 §S4.2), so advice is deliberately relative, never a
 * fabricated absolute number (rule 1). Each suggestion carries the diagnosis `confidence01` so the
 * engineer can hedge or stay silent on thin data. Pure/deterministic; depends on `core` types only.
 */

export interface SetupSuggestion {
  /** What kind of change: anti-roll bar / wing / tyre pressure / camber. */
  area: 'balance' | 'tyre pressure' | 'camber';
  /** The directional, relative change the driver applies in the garage. */
  change: string;
  /** Why — the telemetry read behind it. */
  reason: string;
  confidence01: number;
}

const CORNER = ['front-left', 'front-right', 'rear-left', 'rear-right'] as const;
const round = (c: number | null): string => (c === null ? '?' : String(Math.round(c)));

/**
 * Propose ordered, directional setup changes from the handling diagnosis (most salient first: axle
 * balance, then tyre pressures, then camber). Returns `[]` when the balance is neutral/unknown and the
 * tyres read even — "nothing to change". Never invents an absolute value.
 */
export const proposeSetupChanges = (d: HandlingDiagnosis): SetupSuggestion[] => {
  const out: SetupSuggestion[] = [];
  const conf = d.confidence01;

  // 1. Axle balance — the primary directional change.
  if (d.balance.tendency === 'understeer') {
    out.push({
      area: 'balance',
      change:
        'Free up the front — soften the front anti-roll bar a click or two, or add a touch of front wing.',
      reason: `fronts running hotter (${round(d.balance.frontAvgC)}° vs ${round(d.balance.rearAvgC)}° rear) — understeer`,
      confidence01: conf,
    });
  } else if (d.balance.tendency === 'oversteer') {
    out.push({
      area: 'balance',
      change:
        'Steady the rear — soften the rear anti-roll bar a click or two, or add a touch of rear wing.',
      reason: `rears running hotter (${round(d.balance.rearAvgC)}° vs ${round(d.balance.frontAvgC)}° front) — oversteer`,
      confidence01: conf,
    });
  }

  // 2. Per-corner tyre pressure — centre hot = over-inflated (lower it); edges hot = under (raise it).
  d.pressure.forEach((p, i) => {
    const corner = CORNER[i] ?? `wheel ${i}`;
    if (p.hint === 'over') {
      out.push({
        area: 'tyre pressure',
        change: `Lower the ${corner} tyre pressure a little.`,
        reason: `${corner} centre hotter than the edges — over-inflated`,
        confidence01: conf,
      });
    } else if (p.hint === 'under') {
      out.push({
        area: 'tyre pressure',
        change: `Raise the ${corner} tyre pressure a little.`,
        reason: `${corner} edges hotter than the centre — under-inflated`,
        confidence01: conf,
      });
    }
  });

  // 3. Per-corner camber — inner hot = too much negative camber (reduce); outer hot = add negative.
  d.camber.forEach((c, i) => {
    const corner = CORNER[i] ?? `wheel ${i}`;
    if (c.hint === 'inner-hot') {
      out.push({
        area: 'camber',
        change: `Reduce negative camber on the ${corner}.`,
        reason: `${corner} inner hotter than outer — too much negative camber`,
        confidence01: conf,
      });
    } else if (c.hint === 'outer-hot') {
      out.push({
        area: 'camber',
        change: `Add a little negative camber on the ${corner}.`,
        reason: `${corner} outer hotter than inner — not enough negative camber`,
        confidence01: conf,
      });
    }
  });

  return out;
};
