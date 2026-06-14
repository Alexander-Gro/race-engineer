/**
 * Undercut / overcut evaluation (docs/05 §5). Pure, deterministic — the LLM calls this as the
 * `evaluate_undercut` tool and phrases the result; it never reproduces the math (CLAUDE.md rule 1).
 * Read-only/advisory: it recommends pitting now / later / holding — the driver decides.
 *
 * The undercut: you pit now for fresh tyres while a nearby rival stays out. Over the laps the rival
 * runs on worn tyres before pitting, you swing time in your favour:
 *
 *   undercutGainS = lapsRivalStaysOut · freshTyreGainPerLapS   // you on fresh vs rival on worn, per lap
 *                 − outLapLossS                                // your cold-tyre / pit-exit out-lap penalty
 *                 − (pitLossSelfS − pitLossRivalS)             // pit-delta difference (usually ~0)
 *
 * (This makes docs/05 §5's sketch dimensionally concrete — the fresh-tyre advantage *adds* to the
 * swing; the out-lap penalty and any pit-delta subtract.) The per-lap swing assumes evenly-matched
 * cars: your fresh-vs-worn gain ≈ the rival's worn-tyre deficit. Inputs come from the other models —
 * `freshTyreGainPerLapS` from the tyre model (T7.1), the pit losses from the pit-loss model (T7.2).
 *
 * Decision: pit **now** if the swing clears the gap (gain track position) — chasing, it passes the
 * rival; defending, it covers their threat. Pit **later** (overcut) if pitting now is a net time loss
 * (tyres too fresh to undercut). **Hold** otherwise — within noise, keep watching.
 */

const DEFAULT_MARGIN_S = 0.5;
const DEFAULT_CONFIDENCE = 0.5;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

export interface UndercutInput {
  /** Where the rival sits relative to you: chasing them (`ahead`) or defending from them (`behind`). */
  rival: 'ahead' | 'behind';
  /** Current gap to the rival (s, ≥0). */
  gapS: number;
  /** Your per-lap pace gain on fresh tyres vs your current worn tyres (s/lap). From the tyre model. */
  freshTyreGainPerLapS: number;
  /** Extra time on your out-lap beyond a normal fresh-tyre lap (cold tyres, pit exit) (s). Default 0. */
  outLapLossS?: number;
  /** Your pit-stop time loss (s), from the pit-loss model. */
  pitLossSelfS: number;
  /** The rival's pit-stop time loss (s). Default = yours (same track/service). */
  pitLossRivalS?: number;
  /** Laps the rival stays out after you pit — the undercut horizon. Default 1. */
  lapsRivalStaysOut?: number;
  /** Confidence in the fresh-tyre-advantage estimate (0..1); the engineer hedges when low. Default 0.5. */
  confidence01?: number;
  /** Meaningful-advantage threshold (s); a result inside ±margin is "hold". Default 0.5. */
  marginS?: number;
}

export interface UndercutDecision {
  recommend: 'now' | 'later' | 'hold';
  /**
   * Your projected advantage after the pit cycle (s, signed; >0 = good for you). Chasing: how much
   * the undercut clears the rival by (`gain − gap`). Defending: the lead remaining if the rival
   * undercuts and you don't cover (`gap − gain`).
   */
  deltaS: number;
  /** The time swing in your favour from pitting now vs pitting together (s). */
  undercutGainS: number;
  /** A short human rationale with the key numbers (docs/05 §5: "not a black box"). */
  rationale: string;
  confidence01: number;
}

/** Net time swing in your favour from pitting now while the rival stays out (docs/05 §5). */
export const undercutGainS = (input: UndercutInput): number => {
  const laps = Math.max(1, Math.floor(input.lapsRivalStaysOut ?? 1));
  const outLap = Math.max(0, input.outLapLossS ?? 0);
  const pitDelta = input.pitLossSelfS - (input.pitLossRivalS ?? input.pitLossSelfS);
  return laps * input.freshTyreGainPerLapS - outLap - pitDelta;
};

/** Evaluate the undercut/overcut decision for one rival (docs/05 §5). */
export const evaluateUndercut = (input: UndercutInput): UndercutDecision => {
  const gapS = Math.max(0, input.gapS);
  const margin = Math.max(0, input.marginS ?? DEFAULT_MARGIN_S);
  const gain = undercutGainS(input);
  const confidence01 = clamp01(input.confidence01 ?? DEFAULT_CONFIDENCE);

  if (input.rival === 'ahead') {
    const deltaS = gain - gapS; // how much you clear the rival by after the cycle
    let recommend: UndercutDecision['recommend'];
    let rationale: string;
    if (deltaS > margin) {
      recommend = 'now';
      rationale = `Undercut works: +${round1(gain)}s on fresh tyres clears the ${round1(gapS)}s gap — box now.`;
    } else if (gain < -margin) {
      recommend = 'later';
      rationale = `Tyres too fresh to undercut (${round1(gain)}s swing) — stay out, overcut.`;
    } else {
      recommend = 'hold';
      rationale = `Undercut gains ${round1(gain)}s but not enough to clear ${round1(gapS)}s — hold, decide at the window.`;
    }
    return { recommend, deltaS, undercutGainS: gain, rationale, confidence01 };
  }

  // Defending: the rival could undercut you. Cover if your lead would drop inside the margin.
  const deltaS = gapS - gain; // your remaining lead if they undercut and you don't cover
  const recommend: UndercutDecision['recommend'] = deltaS < margin ? 'now' : 'hold';
  const rationale =
    recommend === 'now'
      ? `Cover the undercut: rival can swing ${round1(gain)}s into your ${round1(gapS)}s — box to defend.`
      : `Lead safe (${round1(deltaS)}s after a rival stop) — hold.`;
  return { recommend, deltaS, undercutGainS: gain, rationale, confidence01 };
};
