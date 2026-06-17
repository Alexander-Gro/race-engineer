import type { Tier, Tire } from '../../schema';
import type { CandidateEvent, EventRule } from '../types';

/**
 * `tire_temp_out_of_window` — fires when a player tyre's representative temperature is outside the
 * operating window: too cold (not up to temp) or overheating. Level-triggered (emits while out), the
 * framework cooldown keeps it to one call-out per direction per window; a per-direction dedupe key
 * lets "cold" and "hot" coexist. Tier 1 (templated). Suppressed in the pit lane, where cold tyres are
 * expected. Read-only/advisory — the engineer phrases it; the driver acts. docs/04 §Events, docs/09.
 */
export interface TireTempThresholds {
  /** Below this representative °C a tyre reads cold (not up to temp). Default 80. */
  minC: number;
  /** Above this representative °C a tyre reads overheating. Default 100. */
  maxC: number;
  tier: Tier;
  priority: number;
  cooldownMs: number;
}

export const DEFAULT_TIRE_TEMP_THRESHOLDS: TireTempThresholds = {
  minC: 80,
  maxC: 100,
  tier: 1,
  priority: 5,
  cooldownMs: 60_000,
};

export interface TireTempOptions {
  thresholds?: Partial<TireTempThresholds>;
}

export const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;

/** A tyre's representative temperature: the single value, or the mean of the 3 zones. */
export const representativeC = (tempC: Tire['tempC']): number =>
  typeof tempC === 'number' ? tempC : (tempC.inner + tempC.center + tempC.outer) / 3;

export const tireTempRule = (options: TireTempOptions = {}): EventRule => {
  const t = { ...DEFAULT_TIRE_TEMP_THRESHOLDS, ...options.thresholds };
  return {
    name: 'tire_temp_out_of_window',
    detect({ curr }) {
      // Cold tyres in the pit lane are expected — don't call it out there.
      if (curr.player.pit.inPitLane) return [];

      const hot: { corner: string; tempC: number }[] = [];
      const cold: { corner: string; tempC: number }[] = [];
      curr.player.tires.slice(0, 4).forEach((tire, i) => {
        const tempC = representativeC(tire.tempC);
        if (!Number.isFinite(tempC)) return;
        const corner = WHEELS[i] ?? `W${i}`;
        if (tempC > t.maxC) hot.push({ corner, tempC });
        else if (tempC < t.minC) cold.push({ corner, tempC });
      });

      const events: CandidateEvent[] = [];
      if (hot.length > 0) {
        const worst = hot.reduce((a, b) => (b.tempC > a.tempC ? b : a));
        events.push({
          type: 'tire_temp_out_of_window',
          tier: t.tier,
          priority: t.priority,
          payload: {
            direction: 'hot',
            corners: hot.map((c) => c.corner),
            tempC: worst.tempC,
            limitC: t.maxC,
          },
          dedupeKey: 'tire_temp_out_of_window:hot',
          cooldownMs: t.cooldownMs,
        });
      }
      if (cold.length > 0) {
        const worst = cold.reduce((a, b) => (b.tempC < a.tempC ? b : a));
        events.push({
          type: 'tire_temp_out_of_window',
          tier: t.tier,
          priority: t.priority,
          payload: {
            direction: 'cold',
            corners: cold.map((c) => c.corner),
            tempC: worst.tempC,
            limitC: t.minC,
          },
          dedupeKey: 'tire_temp_out_of_window:cold',
          cooldownMs: t.cooldownMs,
        });
      }
      return events;
    },
  };
};
