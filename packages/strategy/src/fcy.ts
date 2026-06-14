/**
 * Safety-car / full-course-yellow pit opportunism (docs/05 §7). Pure, deterministic — the LLM phrases
 * the result ("Full-course yellow — box now, we lose almost nothing and we're due in 2 laps anyway");
 * it never reproduces the math (CLAUDE.md rule 1). Read-only/advisory: a recommendation, never an act.
 *
 * Why a stop is "cheap" under caution: pit-loss is the time you concede to a car that *stays out*.
 * Under FCY/SC the field circulates at a fraction of racing pace, so a staying-out rival gains far
 * less on you while you pit — the loss scales roughly with how fast the field is moving:
 *
 *   cautionPitLossS ≈ greenPitLossS · cautionPaceFraction      // first-order heuristic
 *   savedS          = greenPitLossS − cautionPitLossS
 *
 * `cautionPaceFraction` (caution pace ÷ green pace, ~0.5 for an SC) is a per-series calibration; the
 * single-factor model deliberately ignores queue-compression / pit-lane-speed nuances (docs/05 §2:
 * over-modelling is a rabbit hole). `greenPitLossS` comes from the pit-loss model (T7.2).
 */

const DEFAULT_CAUTION_PACE_FRACTION = 0.5;
const DEFAULT_DUE_WITHIN_LAPS = 8;
const DEFAULT_MIN_SAVING_S = 5;
const DEFAULT_CONFIDENCE = 0.6;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

export interface FcyPitLossInput {
  /** The normal green-flag pit-stop time loss (s), from the pit-loss model (T7.2). */
  greenPitLossS: number;
  /** Field caution pace ÷ green pace (0..1). Default 0.5 (a typical safety-car). */
  cautionPaceFraction?: number;
}

export interface FcyPitLoss {
  greenPitLossS: number;
  /** Effective pit-loss if you box under caution. */
  cautionPitLossS: number;
  /** How much cheaper the stop is under caution: `greenPitLoss − cautionPitLoss` (≥ 0). */
  savedS: number;
}

/** The caution pit-loss discount (docs/05 §7). */
export const fcyPitLoss = (input: FcyPitLossInput): FcyPitLoss => {
  const fraction = clamp01(input.cautionPaceFraction ?? DEFAULT_CAUTION_PACE_FRACTION);
  const greenPitLossS = Math.max(0, input.greenPitLossS);
  const cautionPitLossS = greenPitLossS * fraction;
  return { greenPitLossS, cautionPitLossS, savedS: greenPitLossS - cautionPitLossS };
};

export interface FcyStopInput extends FcyPitLossInput {
  /** Is the field currently under FCY/SC? (From `flags.global`.) */
  underCaution: boolean;
  /** Laps until the planned stop (from the stint plan / fuel). Null = unknown. */
  lapsUntilPlannedStop?: number | null;
  /** An outstanding mandatory stop still to serve — worth serving cheaply now. Default false. */
  mandatoryStopDue?: boolean;
  /** Box under caution if the planned stop is within this many laps. Default 8. */
  dueWithinLaps?: number;
  /** Only call it an opportunity if it saves at least this much (s). Default 5. */
  minSavingS?: number;
  /** Confidence in the discount estimate (0..1); the engineer hedges when low. Default 0.6. */
  confidence01?: number;
}

export interface FcyDecision {
  recommend: 'box_now' | 'stay_out';
  /** How much cheaper the stop is under caution (s). */
  savedS: number;
  /** Effective pit-loss if you box now (s). */
  cautionPitLossS: number;
  /** A short human rationale with the key numbers (not a black box). */
  reason: string;
  confidence01: number;
}

/**
 * Decide whether to take the "free" stop under caution (docs/05 §7): box now if we're under FCY/SC,
 * the stop is meaningfully cheaper, **and** we were due to stop soon (or owe a mandatory stop) — an
 * early stop you don't need just buys a later one, so a cheap-but-not-due stop is held.
 */
export const evaluateFcyStop = (input: FcyStopInput): FcyDecision => {
  const { savedS, cautionPitLossS, greenPitLossS } = fcyPitLoss(input);
  const confidence01 = clamp01(input.confidence01 ?? DEFAULT_CONFIDENCE);
  const base = { savedS, cautionPitLossS, confidence01 };

  if (!input.underCaution) {
    return { ...base, recommend: 'stay_out', reason: 'No caution — normal pit-loss applies.' };
  }
  if (savedS < (input.minSavingS ?? DEFAULT_MIN_SAVING_S)) {
    return { ...base, recommend: 'stay_out', reason: 'Caution barely cheaper than green — hold.' };
  }

  const dueWithin = input.dueWithinLaps ?? DEFAULT_DUE_WITHIN_LAPS;
  const lapsUntil = input.lapsUntilPlannedStop ?? null;
  const dueSoon = lapsUntil !== null && lapsUntil <= dueWithin;

  if (dueSoon || input.mandatoryStopDue) {
    const dueNote = dueSoon
      ? `, due in ${lapsUntil}`
      : input.mandatoryStopDue
        ? ', serves the mandatory stop'
        : '';
    return {
      ...base,
      recommend: 'box_now',
      reason: `Caution — box now: ~${round1(cautionPitLossS)}s vs ${round1(greenPitLossS)}s green (save ${round1(savedS)}s)${dueNote}.`,
    };
  }

  return {
    ...base,
    recommend: 'stay_out',
    reason: `Cheap stop (save ${round1(savedS)}s) but not due for ${lapsUntil ?? '?'} laps — an early stop costs a later one.`,
  };
};
