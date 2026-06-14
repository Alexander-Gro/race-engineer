import type { CandidateEvent, EventRule } from '../types';

/**
 * `lap_completed` — edge-triggered when the player's completed-lap count increments. Once per
 * lap by construction (it only fires on the transition tick), so it needs no cooldown.
 * Tier 1 (templated: "lap done, fuel X"). docs/04 §Events.
 */
export const lapCompletedRule = (priority = 3): EventRule => ({
  name: 'lap_completed',
  detect({ prev, curr }) {
    if (!prev || curr.player.lapsCompleted <= prev.player.lapsCompleted) return [];
    const event: CandidateEvent = {
      type: 'lap_completed',
      tier: 1,
      priority,
      payload: { lap: curr.player.lapsCompleted, lastLapS: curr.player.lastLapS },
    };
    return [event];
  },
});
