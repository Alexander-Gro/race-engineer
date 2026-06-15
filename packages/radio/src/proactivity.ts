import type { EngineerEvent } from '@race-engineer/core';

/**
 * Proactivity controls + quiet windows (build-plan T8.5, docs/06 §Proactive, docs/07 §Quiet windows).
 * A pure gate deciding whether a proactive call-out should be *spoken right now*:
 *
 *  - **Proactivity level** caps how chatty the engineer is (the driver's setting, T6.3).
 *  - **Quiet windows** hold non-urgent chatter during high driver load (heavy braking / hard
 *    cornering) so the engineer never talks over a corner.
 *  - **Safety always overrides:** a Tier-0 reflex spotter call ("car left") is never suppressed —
 *    not by `off`, not by a quiet window.
 *
 * Pure/deterministic; the radio layer applies it before routing events to audio. Read-only/advisory.
 */

export type ProactivityLevel = 'off' | 'low' | 'normal' | 'high';

/**
 * Highest event tier each level will *speak* (Tier-0 safety always passes regardless — see
 * {@link shouldAnnounce}). `off` = nothing but the safety reflex; `low` = + urgent (Tier 1);
 * `normal` = + conversational (Tier 2); `high` = everything (Tier 3 deliberative too).
 */
const MAX_TIER_BY_LEVEL: Record<ProactivityLevel, number> = { off: -1, low: 1, normal: 2, high: 3 };

/** Driver inputs used to detect a high-load moment (0..1 pedals; steer signed, ~-1..1). */
export interface DriverLoadInputs {
  brake: number;
  steer: number;
}

export interface QuietWindowOptions {
  /** Brake fraction at/above which the driver is "hard on the brakes". Default 0.6. */
  brakeThreshold?: number;
  /** |steer| at/above which the driver is "hard in a corner". Default 0.5. */
  steerThreshold?: number;
}

/**
 * Is the driver in a high-load moment where non-urgent chatter should hold (docs/07)? Heavy braking
 * or hard steering. (No combined-g in the canonical schema yet — brake + steer are the proxy.)
 */
export const isQuietWindow = (
  inputs: DriverLoadInputs,
  options: QuietWindowOptions = {},
): boolean => {
  const brakeThreshold = options.brakeThreshold ?? 0.6;
  const steerThreshold = options.steerThreshold ?? 0.5;
  return inputs.brake >= brakeThreshold || Math.abs(inputs.steer) >= steerThreshold;
};

/** Tier at/above which a call-out counts as non-urgent "chatter" (held during a quiet window). */
const CHATTER_TIER = 2;

export interface AnnounceContext {
  level: ProactivityLevel;
  /** Current driver inputs for the quiet-window check; omit to skip it (e.g. no telemetry yet). */
  inputs?: DriverLoadInputs | undefined;
  quietWindow?: QuietWindowOptions;
}

/**
 * Should this proactive call-out be spoken now? Tier-0 safety reflex always passes. Otherwise the
 * proactivity level caps the tier, and during a quiet window only urgent (Tier < 2) calls get through.
 */
export const shouldAnnounce = (
  event: Pick<EngineerEvent, 'tier'>,
  ctx: AnnounceContext,
): boolean => {
  if (event.tier === 0) return true; // safety reflex — never suppressed (docs/07 "urgent overrides")
  if (event.tier > MAX_TIER_BY_LEVEL[ctx.level]) return false; // chattiness cap
  if (ctx.inputs && event.tier >= CHATTER_TIER && isQuietWindow(ctx.inputs, ctx.quietWindow)) {
    return false; // hold non-urgent chatter mid-corner / under braking
  }
  return true;
};
