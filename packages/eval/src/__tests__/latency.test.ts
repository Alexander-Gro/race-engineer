import { FakeProvider, type RaceContext } from '@race-engineer/ai';
import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import { ReactiveRadioLoop } from '@race-engineer/radio';
import {
  FakeSttProvider,
  FakeTtsProvider,
  MockAudioSink,
  MockMicSource,
  RadioCapture,
  VoicePlayer,
} from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import { summarizeTurnLatencies, withinBudget, type TurnLatency } from '../latency';

const ctx: RaceContext = { raceState: multiClassTrafficState, fuelPlan: null };

/** A clock that advances by the next queued delta on each call (deterministic). */
const makeClock = (deltas: readonly number[]): (() => number) => {
  let t = 0;
  let i = 0;
  return () => {
    t += deltas[i++] ?? 0;
    return t;
  };
};

/**
 * Run `turns` scripted Tier-2 conversational turns through the real {@link ReactiveRadioLoop} with
 * an injected clock modelling per-component costs. The loop calls `now()` three times per voiced
 * turn (transcript-ready → reply-ready → first-audio), so each turn's delta triple is
 * `[sttMs, llmMs, ttsFirstChunkMs]` and its time-to-first-audio is `llmMs + ttsFirstChunkMs`.
 */
const runLatencyEval = async (
  turns: number,
  perTurnDeltas: readonly [number, number, number],
): Promise<TurnLatency[]> => {
  const samples: TurnLatency[] = [];
  const mic = new MockMicSource();
  const deltas = Array.from({ length: turns }, () => perTurnDeltas).flat();
  const loop = new ReactiveRadioLoop({
    provider: new FakeProvider(
      Array.from({ length: turns }, () => ({ text: 'Two seconds clear.' })),
    ),
    context: () => ctx,
    capture: new RadioCapture({ stt: new FakeSttProvider(), mic }),
    player: new VoicePlayer(new MockAudioSink()),
    tts: new FakeTtsProvider(),
    voice: 'v1',
    now: makeClock(deltas),
    events: { onLatency: (l) => samples.push(l) },
  });

  for (let k = 0; k < turns; k += 1) {
    loop.pttDown();
    mic.emit('gap');
    await loop.pttUp();
  }
  return samples;
};

describe('latency eval — Tier-2 conversational path vs the docs/01 budget', () => {
  it('passes when modelled component costs keep first-audio under 2 s', async () => {
    // STT 600 ms, LLM 900 ms, TTS first-chunk 300 ms → first-audio 1200 ms < 2000 ms.
    const samples = await runLatencyEval(4, [600, 900, 300]);
    expect(samples).toHaveLength(4);
    for (const s of samples) {
      expect(s.tier).toBe(2);
      expect(s.toFirstAudioMs).toBe(1200);
      expect(withinBudget(s)).toBe(true);
    }
    const summary = summarizeTurnLatencies(samples);
    expect(summary.count).toBe(4);
    expect(summary.p95Ms).toBe(1200);
    expect(summary.budgetMs).toBe(2000);
    expect(summary.withinBudget).toBe(true);
  });

  it('flags the budget when first-audio blows past 2 s (the gate actually measures latency)', async () => {
    // LLM 2200 ms + TTS 400 ms → first-audio 2600 ms > 2000 ms.
    const samples = await runLatencyEval(3, [500, 2200, 400]);
    for (const s of samples) expect(s.toFirstAudioMs).toBe(2600);
    const summary = summarizeTurnLatencies(samples);
    expect(summary.p95Ms).toBe(2600);
    expect(summary.withinBudget).toBe(false);
  });

  it('an empty sample set is vacuously within budget', () => {
    expect(summarizeTurnLatencies([]).withinBudget).toBe(true);
  });
});
