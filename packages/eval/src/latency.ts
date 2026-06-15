import type { Tier } from '@race-engineer/core';
import {
  LATENCY_BUDGET_MS,
  LatencyAggregator,
  withinBudget,
  type LatencySummary,
  type TurnLatency,
} from '@race-engineer/radio';

/**
 * Latency eval (docs/06 §Evaluation "keep Tier-2 under budget", docs/01 §Latency tiers): aggregate
 * the per-turn time-to-first-audio samples a radio path emits (`onLatency` → {@link TurnLatency})
 * and check the **p95 against the tier budget** ({@link LATENCY_BUDGET_MS}). This is the CI gate the
 * latency tests drive by running the real `ReactiveRadioLoop` over scripted turns with an injected
 * clock — the only deterministic way to eval voice latency offline (no real STT/LLM/TTS network).
 *
 * The budgeted figure is **time-to-first-audio** (the driver hears the first words while the rest
 * streams), not total reply length. Pure aggregation — measurement lives in the radio loop.
 */
export { LATENCY_BUDGET_MS, withinBudget };
export type { LatencySummary, TurnLatency };

/** Aggregate turn latencies for one tier and report min/mean/max/p95 vs the budget (docs/01). */
export const summarizeTurnLatencies = (
  samples: readonly TurnLatency[],
  tier: Tier = 2,
): LatencySummary => {
  const agg = new LatencyAggregator(tier);
  for (const s of samples) agg.record(s);
  return agg.summary();
};
