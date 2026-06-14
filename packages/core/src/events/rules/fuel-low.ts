import type { Tier } from '../../schema';
import type { CandidateEvent, EventRule } from '../types';

/**
 * `fuel_low` — fires when the Normalizer-derived laps-remaining-on-fuel drops to/below a
 * threshold. Level-triggered (emits while below), with the framework's cooldown keeping it to
 * one call-out per threshold per cooldown window. Multiple thresholds give escalating
 * urgency (e.g. warn at 4 laps, urgent at 2). Tier 1 (templated). docs/04 §Events.
 */
export interface FuelLowThreshold {
  lapsRemaining: number;
  tier: Tier;
  priority: number;
  cooldownMs: number;
}

export interface FuelLowOptions {
  thresholds?: readonly FuelLowThreshold[];
}

export const DEFAULT_FUEL_LOW_THRESHOLDS: readonly FuelLowThreshold[] = [
  { lapsRemaining: 4, tier: 1, priority: 6, cooldownMs: 120_000 },
  { lapsRemaining: 2, tier: 1, priority: 8, cooldownMs: 120_000 },
];

export const fuelLowRule = (options: FuelLowOptions = {}): EventRule => {
  const thresholds = options.thresholds ?? DEFAULT_FUEL_LOW_THRESHOLDS;
  return {
    name: 'fuel_low',
    detect({ curr }) {
      const lapsRemaining = curr.player.fuel.lapsRemainingEst;
      if (lapsRemaining === null) return [];
      const events: CandidateEvent[] = [];
      for (const threshold of thresholds) {
        if (lapsRemaining <= threshold.lapsRemaining) {
          events.push({
            type: 'fuel_low',
            tier: threshold.tier,
            priority: threshold.priority,
            payload: { lapsRemaining, thresholdLaps: threshold.lapsRemaining },
            dedupeKey: `fuel_low:${threshold.lapsRemaining}`,
            cooldownMs: threshold.cooldownMs,
          });
        }
      }
      return events;
    },
  };
};
