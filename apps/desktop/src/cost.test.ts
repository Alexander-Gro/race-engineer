import { describe, expect, it } from 'vitest';
import { DEFAULT_USAGE, estimateCloudCost, llmHourlyCostUsd, type UsageAssumptions } from './cost';
import { DEFAULT_SETTINGS, type AppSettings, type LlmProviderId } from './settings';

/** Settings with a given LLM provider (+ optional model), free/local voice otherwise. */
const withLlm = (provider: LlmProviderId, model?: string): AppSettings => ({
  ...DEFAULT_SETTINGS,
  llm: model ? { provider, model } : { provider },
});

describe('llmHourlyCostUsd', () => {
  it('is $0 for every free route (template / ollama / free-tier cloud)', () => {
    for (const p of ['template', 'ollama', 'groq', 'gemini', 'openrouter'] as const) {
      expect(llmHourlyCostUsd({ provider: p })).toBe(0);
    }
  });

  it('reproduces the docs/15 budget figure for Claude Haiku (~$0.15/hour)', () => {
    // 30 interactions × (3000/1e6·$1 + 400/1e6·$5) = 30 × $0.005 = $0.15
    expect(llmHourlyCostUsd({ provider: 'claude' })).toBeCloseTo(0.15, 10);
  });

  it('prices Claude Opus higher than Haiku', () => {
    const haiku = llmHourlyCostUsd({ provider: 'claude', model: 'claude-haiku-4-5' });
    const opus = llmHourlyCostUsd({ provider: 'claude', model: 'claude-opus-4-8' });
    expect(opus).toBeCloseTo(0.75, 10); // 30 × (3000/1e6·$5 + 400/1e6·$25)
    expect(opus!).toBeGreaterThan(haiku!);
  });

  it('returns null (unknown — never a guess) for a paid route with an unpriced model', () => {
    expect(llmHourlyCostUsd({ provider: 'claude', model: 'some-future-model' })).toBeNull();
  });

  it('scales linearly with interaction volume (monotonic, no NaN)', () => {
    const base = llmHourlyCostUsd({ provider: 'claude' }, DEFAULT_USAGE)!;
    const doubled = llmHourlyCostUsd(
      { provider: 'claude' },
      { ...DEFAULT_USAGE, interactionsPerHour: DEFAULT_USAGE.interactionsPerHour * 2 },
    )!;
    expect(doubled).toBeCloseTo(base * 2, 10);
    expect(Number.isFinite(doubled)).toBe(true);
  });
});

describe('estimateCloudCost', () => {
  it('reports the free/local default profile as $0', () => {
    const est = estimateCloudCost(DEFAULT_SETTINGS);
    expect(est.isFree).toBe(true);
    expect(est.hourlyUsd).toBe(0);
    expect(est.perRaceUsd).toBe(0);
    expect(est.hourly).toEqual({ llmUsd: 0, sttUsd: 0, ttsUsd: 0 });
    expect(est.summary).toMatch(/Free — \$0\/hour/);
  });

  it('estimates Claude Haiku per hour and over a 24 h Le Mans', () => {
    const est = estimateCloudCost(withLlm('claude'));
    expect(est.isFree).toBe(false);
    expect(est.hourlyUsd).toBeCloseTo(0.15, 10);
    expect(est.raceHours).toBe(24);
    expect(est.perRaceUsd).toBeCloseTo(3.6, 10);
    expect(est.summary).toContain('$0.15/hour');
    expect(est.summary).toContain('$3.60 per 24 h');
    expect(est.summary).toContain('your own key');
  });

  it('honours a custom race length', () => {
    const est = estimateCloudCost(withLlm('claude'), { raceHours: 1 });
    expect(est.perRaceUsd).toBeCloseTo(0.15, 10);
    expect(est.summary).toContain('per 1 h race');
  });

  it('surfaces an unknown-model paid route honestly (no invented number)', () => {
    const est = estimateCloudCost(withLlm('claude', 'mystery-9'));
    expect(est.isFree).toBe(false);
    expect(est.hourlyUsd).toBeNull();
    expect(est.perRaceUsd).toBeNull();
    expect(est.summary).toMatch(/depends on your model/);
  });

  it('keeps voice free for the local engines regardless of LLM route', () => {
    const est = estimateCloudCost(withLlm('claude'));
    expect(est.hourly.sttUsd).toBe(0);
    expect(est.hourly.ttsUsd).toBe(0);
  });

  it('produces no NaN/∞ across providers', () => {
    const usage: UsageAssumptions = { ...DEFAULT_USAGE };
    for (const p of ['template', 'ollama', 'groq', 'gemini', 'openrouter', 'claude'] as const) {
      const est = estimateCloudCost(withLlm(p), { usage });
      const total = est.hourlyUsd;
      if (total !== null) expect(Number.isFinite(total)).toBe(true);
    }
  });
});
