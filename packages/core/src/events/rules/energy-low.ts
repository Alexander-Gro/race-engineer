import type { Tier } from '../../schema';
import type { CandidateEvent, EventRule } from '../types';

/**
 * `energy_low` — the Virtual-Energy sibling of `fuel_low` (build-plan T11.5). Fires when the
 * laps-remaining-on-VE drops to/below a threshold. In LMU a stint is frequently limited by Virtual
 * Energy, not fuel, so the engineer must warn on energy the same way it warns on fuel. Level-
 * triggered (emits while below), framework cooldown keeps it to one call-out per threshold per
 * window; escalating thresholds give rising urgency. Tier 1 (templated). Silent when VE is absent
 * or its laps-remaining is unknown (the source doesn't expose VE / still learning). docs/04 §Events.
 */
export interface EnergyLowThreshold {
  lapsRemaining: number;
  tier: Tier;
  priority: number;
  cooldownMs: number;
}

export interface EnergyLowOptions {
  thresholds?: readonly EnergyLowThreshold[];
}

export const DEFAULT_ENERGY_LOW_THRESHOLDS: readonly EnergyLowThreshold[] = [
  { lapsRemaining: 4, tier: 1, priority: 6, cooldownMs: 120_000 },
  { lapsRemaining: 2, tier: 1, priority: 8, cooldownMs: 120_000 },
];

export const energyLowRule = (options: EnergyLowOptions = {}): EventRule => {
  const thresholds = options.thresholds ?? DEFAULT_ENERGY_LOW_THRESHOLDS;
  return {
    name: 'energy_low',
    detect({ curr }) {
      const lapsRemaining = curr.player.virtualEnergy?.lapsRemainingEst ?? null;
      if (lapsRemaining === null) return []; // no VE exposed / still learning → silent
      const events: CandidateEvent[] = [];
      for (const threshold of thresholds) {
        if (lapsRemaining <= threshold.lapsRemaining) {
          events.push({
            type: 'energy_low',
            tier: threshold.tier,
            priority: threshold.priority,
            payload: { lapsRemaining, thresholdLaps: threshold.lapsRemaining },
            dedupeKey: `energy_low:${threshold.lapsRemaining}`,
            cooldownMs: threshold.cooldownMs,
          });
        }
      }
      return events;
    },
  };
};
