import type { RaceState, StintPlan, Tier } from '../../schema';
import type { CandidateEvent, EventRule } from '../types';

/**
 * Proactive **strategy** call-outs from the stint plan (build-plan T7.9, docs/05). The always-on
 * strategy engine computes the pit windows (T7.3); this rule turns the player crossing those window
 * boundaries into spoken call-outs:
 *
 *  - `pit_window_open` (Tier 2) — the moment the next pit window opens ("pit window's open, lap 8–22").
 *  - `box_this_lap`   (Tier 1) — the last lap to pit within that window ("box this lap").
 *
 * **Edge-triggered** on the lap-boundary crossing (like the spotter's `clear` / the FCY edge), with
 * the {@link EventDetector}'s cooldown guarding against plan jitter. The *math* (the windows
 * themselves) is `@race-engineer/strategy` (T7.3); this only reads the already-computed laps and
 * compares them to the player's lap — `core` can't import `strategy` (the dependency runs the other
 * way), so the plan arrives via {@link DetectionContext.strategy}. Read-only/advisory.
 */

export interface StrategyCalloutOptions {
  /** Delivery tier for `pit_window_open`. Default 2 (conversational). */
  pitWindowTier?: Tier;
  /** Delivery tier for `box_this_lap`. Default 1 (urgent, templated). */
  boxTier?: Tier;
  pitWindowPriority?: number;
  boxPriority?: number;
  /** Suppress a re-fire of the same call-out within this window (ms) — de-jitters the plan. Default 120000. */
  cooldownMs?: number;
  /**
   * Don't promote a window to a spoken call-out until the underlying fuel plan is this confident
   * (docs/05 §8 "trustworthy or silent") — a window built from one or two noisy laps stays quiet
   * (the UI still shows it). Default 0.4 (~a few green laps). 0 disables the gate.
   */
  minConfidence01?: number;
}

/** The lap the player is currently running (1 = the first flying lap). */
const currentLap = (state: RaceState): number => state.player.lapsCompleted + 1;

const nextWindow = (plan: StintPlan | null): StintPlan['pitWindows'][number] | null =>
  plan && plan.pitWindows.length > 0 ? plan.pitWindows[0]! : null;

/** Did the player cross lap `boundary` between the previous tick and now (or join already past it)? */
const crossed = (prevLap: number, curLap: number, boundary: number): boolean =>
  prevLap < boundary && curLap >= boundary;

export const strategyCalloutRule = (options: StrategyCalloutOptions = {}): EventRule => {
  const pitWindowTier = options.pitWindowTier ?? 2;
  const boxTier = options.boxTier ?? 1;
  const pitWindowPriority = options.pitWindowPriority ?? 45;
  const boxPriority = options.boxPriority ?? 70;
  const cooldownMs = options.cooldownMs ?? 120_000;
  const minConfidence01 = options.minConfidence01 ?? 0.4;

  return {
    name: 'strategy-callouts',
    detect({ prev, curr, strategy }) {
      const window = nextWindow(strategy?.stintPlan ?? null);
      // Nothing to say without a plan, or while the driver is already in the pit lane.
      if (window === null || curr.player.pit.inPitLane) return [];
      // Trustworthy or silent (docs/05 §8): stay quiet until the fuel plan the window rests on is
      // confident enough. The window still shows in the UI; we just don't *speak* a shaky one.
      if ((strategy?.fuelPlan?.confidence01 ?? 0) < minConfidence01) return [];

      const curLap = currentLap(curr);
      // First tick: treat as having just crossed in from the lap before (fires once on join).
      const prevLap = prev ? currentLap(prev) : curLap - 1;
      const out: CandidateEvent[] = [];

      // The window just opened (crossed earliestLap, still before the deadline).
      if (crossed(prevLap, curLap, window.earliestLap) && curLap <= window.latestLap) {
        out.push({
          type: 'pit_window_open',
          tier: pitWindowTier,
          priority: pitWindowPriority,
          payload: {
            earliestLap: window.earliestLap,
            latestLap: window.latestLap,
            reason: window.reason,
          },
          dedupeKey: 'pit_window_open',
          cooldownMs,
        });
      }

      // The last lap to pit within the window (crossed latestLap).
      if (crossed(prevLap, curLap, window.latestLap)) {
        out.push({
          type: 'box_this_lap',
          tier: boxTier,
          priority: boxPriority,
          payload: { latestLap: window.latestLap, reason: window.reason },
          dedupeKey: 'box_this_lap',
          cooldownMs,
        });
      }

      return out;
    },
  };
};
