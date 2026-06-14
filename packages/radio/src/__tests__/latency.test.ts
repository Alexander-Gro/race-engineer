import {
  FakeProvider,
  type FakeStep,
  type HallucinationReport,
  type RaceContext,
} from '@race-engineer/ai';
import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import {
  FakeSttProvider,
  FakeTtsProvider,
  MockAudioSink,
  MockMicSource,
  RadioCapture,
  VoicePlayer,
} from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import { ReactiveRadioLoop, type ReactiveRadioLoopEvents } from '../loop';
import { LATENCY_BUDGET_MS, LatencyAggregator, withinBudget, type TurnLatency } from '../latency';

const ctx: RaceContext = { raceState: multiClassTrafficState, fuelPlan: null };

/** A loop with an auto-advancing clock: each `now()` returns the previous value + `step`. */
const makeLoop = (steps: FakeStep[], events: ReactiveRadioLoopEvents, step = 10) => {
  const mic = new MockMicSource();
  const player = new VoicePlayer(new MockAudioSink());
  let t = 0;
  const loop = new ReactiveRadioLoop({
    provider: new FakeProvider(steps),
    context: () => ctx,
    capture: new RadioCapture({ stt: new FakeSttProvider(), mic }),
    player,
    tts: new FakeTtsProvider(),
    voice: 'v1',
    now: () => {
      t += step;
      return t;
    },
    events,
  });
  return { loop, mic };
};

describe('LATENCY_BUDGET_MS', () => {
  it('exposes the docs/01 per-tier first-audio budgets', () => {
    expect(LATENCY_BUDGET_MS).toEqual({ 0: 300, 1: 700, 2: 2000, 3: null });
  });
});

describe('withinBudget', () => {
  it('compares first-audio against the tier budget; best-effort (Tier 3) always passes', () => {
    const at = (tier: 0 | 1 | 2 | 3, toFirstAudioMs: number): TurnLatency => ({
      tier,
      sttToReplyMs: 0,
      replyToFirstAudioMs: 0,
      toFirstAudioMs,
    });
    expect(withinBudget(at(2, 1500))).toBe(true);
    expect(withinBudget(at(2, 2500))).toBe(false);
    expect(withinBudget(at(0, 250))).toBe(true);
    expect(withinBudget(at(0, 350))).toBe(false);
    expect(withinBudget(at(3, 99999))).toBe(true);
  });
});

describe('LatencyAggregator', () => {
  it('aggregates samples and passes when p95 is within the tier budget', () => {
    const agg = new LatencyAggregator(2);
    for (const ms of [100, 200, 300, 400, 1800]) agg.add(ms);
    const s = agg.summary();
    expect(s).toMatchObject({ count: 5, minMs: 100, maxMs: 1800, meanMs: 560, budgetMs: 2000 });
    expect(s.p95Ms).toBe(1800);
    expect(s.withinBudget).toBe(true);
  });

  it('flags when p95 blows the budget', () => {
    const agg = new LatencyAggregator(2);
    for (const ms of [100, 100, 100, 100, 2500]) agg.add(ms);
    const s = agg.summary();
    expect(s.p95Ms).toBe(2500);
    expect(s.withinBudget).toBe(false);
  });

  it('an empty aggregator is vacuously within budget', () => {
    expect(new LatencyAggregator(2).summary()).toMatchObject({ count: 0, withinBudget: true });
  });
});

describe('ReactiveRadioLoop — latency instrumentation', () => {
  it('measures Tier-2 first-audio latency for a voiced turn', async () => {
    const samples: TurnLatency[] = [];
    const { loop, mic } = makeLoop([{ text: 'Two seconds clear.' }], {
      onLatency: (l) => samples.push(l),
    });

    loop.pttDown();
    mic.emit('gap');
    await loop.pttUp();

    expect(samples).toHaveLength(1);
    const l = samples[0]!;
    // Clock advances 10 ms per call: transcript@10, reply@20, first-audio@30.
    expect(l.tier).toBe(2);
    expect(l.sttToReplyMs).toBe(10);
    expect(l.replyToFirstAudioMs).toBe(10);
    expect(l.toFirstAudioMs).toBe(20);
    expect(withinBudget(l)).toBe(true); // 20 ms ≪ 2000 ms budget
  });

  it('emits no latency for a skipped (empty-transcript) turn', async () => {
    const samples: TurnLatency[] = [];
    const { loop } = makeLoop([{ text: 'unused' }], { onLatency: (l) => samples.push(l) });
    loop.pttDown();
    await loop.pttUp(); // no mic frames → nothing voiced
    expect(samples).toEqual([]);
  });
});

describe('ReactiveRadioLoop — hallucination guard wiring', () => {
  it('reports grounded when the spoken figure came from a tool', async () => {
    const reports: HallucinationReport[] = [];
    const { loop, mic } = makeLoop(
      [{ tools: [{ name: 'get_race_state' }] }, { text: 'You are running P8.' }],
      { onHallucinationCheck: (r) => reports.push(r) },
    );
    loop.pttDown();
    mic.emit('position');
    await loop.pttUp();
    // Player position in the fixture is 8 → the spoken "8" is grounded.
    expect(reports).toHaveLength(1);
    expect(reports[0]?.grounded).toBe(true);
  });

  it('flags a fabricated figure the tools never returned', async () => {
    const reports: HallucinationReport[] = [];
    const { loop, mic } = makeLoop(
      [{ tools: [{ name: 'get_race_state' }] }, { text: 'You are P99.' }],
      { onHallucinationCheck: (r) => reports.push(r) },
    );
    loop.pttDown();
    mic.emit('position');
    await loop.pttUp();
    expect(reports[0]?.grounded).toBe(false);
    expect(reports[0]?.ungrounded.some((u) => u.value === 99)).toBe(true);
  });
});
