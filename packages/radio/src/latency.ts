import type { Tier } from '@race-engineer/core';

/**
 * Latency harness (docs/01 §Latency tiers, docs/07 §Latency budget): time the radio paths and
 * check them against the per-tier first-audio budgets. The reactive loop is the **Tier-2
 * conversational** path (STT → AI(+tools) → streaming TTS, < 2 s to first audio); the Tier-0/1
 * reflex/templated paths land with the proactive call-outs (T5.4) and report through the same
 * {@link TurnLatency} / {@link LatencyAggregator} shape.
 *
 * The budgeted figure is **time-to-first-audio**, not total reply length: the driver hears the
 * first words while the rest streams. Pure measurement — the loop supplies timestamps from an
 * injectable clock so this is deterministic in tests.
 */

/** First-audio latency budgets per delivery tier (docs/01). `null` ⇒ best-effort (Tier 3). */
export const LATENCY_BUDGET_MS: Record<Tier, number | null> = {
  0: 300, // reflex spotter — pre-rendered, no network
  1: 700, // templated strategy — template + cached/synth TTS
  2: 2000, // conversational reply — to first audio
  3: null, // deliberative — best effort
};

/** Breakdown of one voiced turn's latency (all deltas in ms). */
export interface TurnLatency {
  tier: Tier;
  /** Final transcript ready → LLM reply text ready (STT-to-reply). */
  sttToReplyMs: number;
  /** Reply text ready → first audio enqueued (TTS first-chunk). */
  replyToFirstAudioMs: number;
  /** Final transcript ready → first audio — the figure checked against the budget. */
  toFirstAudioMs: number;
}

/** Did this turn hit first audio within its tier's budget? Best-effort tiers always pass. */
export const withinBudget = (latency: TurnLatency): boolean => {
  const budget = LATENCY_BUDGET_MS[latency.tier];
  return budget === null || latency.toFirstAudioMs <= budget;
};

export interface LatencySummary {
  count: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  /** 95th-percentile time-to-first-audio (nearest-rank). */
  p95Ms: number;
  budgetMs: number | null;
  /** p95 within budget — the gate used for the latency tests / CI eval (docs/06 §Evaluation). */
  withinBudget: boolean;
}

/**
 * Accumulates time-to-first-audio samples for one tier and reports min/mean/max/p95 against the
 * budget. Feed it {@link TurnLatency} from the loop's `onLatency`, or raw ms via {@link add}.
 */
export class LatencyAggregator {
  readonly #tier: Tier;
  readonly #samples: number[] = [];

  constructor(tier: Tier = 2) {
    this.#tier = tier;
  }

  /** Record a turn (uses its `toFirstAudioMs`). */
  record(latency: TurnLatency): void {
    this.add(latency.toFirstAudioMs);
  }

  /** Record a raw time-to-first-audio sample (ms). */
  add(ms: number): void {
    this.#samples.push(ms);
  }

  get count(): number {
    return this.#samples.length;
  }

  summary(): LatencySummary {
    const budgetMs = LATENCY_BUDGET_MS[this.#tier];
    const n = this.#samples.length;
    if (n === 0) {
      return { count: 0, minMs: 0, maxMs: 0, meanMs: 0, p95Ms: 0, budgetMs, withinBudget: true };
    }
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    // Nearest-rank p95: index ceil(0.95·n)−1, clamped into range.
    const rank = Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1));
    const p95Ms = sorted[rank] ?? 0;
    const minMs = sorted[0] ?? 0;
    const maxMs = sorted[n - 1] ?? 0;
    return {
      count: n,
      minMs,
      maxMs,
      meanMs: sum / n,
      p95Ms,
      budgetMs,
      withinBudget: budgetMs === null || p95Ms <= budgetMs,
    };
  }
}
