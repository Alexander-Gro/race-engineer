import { FakeProvider } from '@race-engineer/ai';
import {
  EventDetector,
  fuelLowRule,
  spotterRule,
  type EngineerEvent,
  type EventType,
  type RaceState,
} from '@race-engineer/core';
import { lowFuelState, multiClassTrafficState } from '@race-engineer/core/fixtures';
import {
  FakeTtsProvider,
  MockAudioSink,
  prerenderTier0,
  VoicePlayer,
  VoicePriority,
  type AudioChunk,
  type TtsProvider,
  type VoiceId,
} from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import {
  defaultVoicePriority,
  llmPhraser,
  ProactiveVoiceRouter,
  templatePhraser,
  type ProactiveVoiceRouterOptions,
} from '../proactive';

/** Build a minimal EngineerEvent for routing tests. */
const ev = (
  type: EventType,
  payload: Record<string, unknown> = {},
  extra: Partial<EngineerEvent> = {},
): EngineerEvent => ({ id: `${type}:0`, tick: 0, type, tier: 0, priority: 0, payload, ...extra });

/** TTS that counts synthesize calls — used to prove Tier-0 never synthesizes. */
class CountingTts implements TtsProvider {
  readonly name = 'counting';
  synthCalls = 0;
  readonly #inner = new FakeTtsProvider();
  synthesizeStream(text: string, voice: VoiceId): AsyncIterable<AudioChunk> {
    this.synthCalls += 1;
    return this.#inner.synthesizeStream(text, voice);
  }
  prerender(phrases: readonly string[], voice: VoiceId) {
    return this.#inner.prerender(phrases, voice);
  }
}

const makeRouter = async (overrides: Partial<ProactiveVoiceRouterOptions> = {}) => {
  const sink = new MockAudioSink();
  const player = new VoicePlayer(sink);
  const tts = new CountingTts();
  const tier0Clips = await prerenderTier0(new FakeTtsProvider(), 'v1');
  const router = new ProactiveVoiceRouter({ player, tts, voice: 'v1', tier0Clips, ...overrides });
  return { sink, player, tts, tier0Clips, router };
};

describe('templatePhraser', () => {
  it('phrases fuel_low from the payload number, going critical under ~1 lap; null otherwise', () => {
    expect(templatePhraser(ev('fuel_low', { lapsRemaining: 3.8, thresholdLaps: 4 }))).toBe(
      "Fuel's low — about 3 laps left.",
    );
    expect(templatePhraser(ev('fuel_low', { lapsRemaining: 1.06, thresholdLaps: 2 }))).toBe(
      'Fuel critical — box this lap.',
    );
    expect(templatePhraser(ev('lap_completed'))).toBeNull();
  });

  it('phrases energy_low from the payload number, going critical under ~1 lap (T11.5)', () => {
    expect(templatePhraser(ev('energy_low', { lapsRemaining: 3.8, thresholdLaps: 4 }))).toBe(
      "Energy's low — about 3 laps left.",
    );
    expect(templatePhraser(ev('energy_low', { lapsRemaining: 0.9, thresholdLaps: 2 }))).toBe(
      'Energy critical — box this lap.',
    );
  });

  it('phrases tire_temp_out_of_window by direction (hot/cold)', () => {
    expect(templatePhraser(ev('tire_temp_out_of_window', { direction: 'hot' }))).toMatch(
      /overheating/i,
    );
    expect(templatePhraser(ev('tire_temp_out_of_window', { direction: 'cold' }))).toMatch(
      /below temperature/i,
    );
  });

  it('phrases the background strategist strategy_update by kind (T8.2)', () => {
    expect(
      templatePhraser(ev('strategy_update', { kind: 'energy-save', savePerLapPct: 1.8 })),
    ).toMatch(/energy-limited.*1\.8% a lap/);
    expect(
      templatePhraser(ev('strategy_update', { kind: 'fuel-save', savePerLapLiters: 0.25 })),
    ).toMatch(/fuel's tight.*0\.25 a lap/);
  });

  it('phrases the strategy pit-window call-outs from the payload (T7.9)', () => {
    expect(
      templatePhraser(ev('pit_window_open', { earliestLap: 8, latestLap: 22 }, { tier: 2 })),
    ).toBe("Pit window's open — lap 8 to 22.");
    expect(templatePhraser(ev('box_this_lap', { latestLap: 22 }, { tier: 1 }))).toBe(
      'Box this lap.',
    );
  });
});

describe('defaultVoicePriority', () => {
  it('maps reflex calls to SPOTTER, clear to STRATEGY, and fuel_low by urgency', () => {
    expect(defaultVoicePriority(ev('car_left'))).toBe(VoicePriority.SPOTTER);
    expect(defaultVoicePriority(ev('three_wide'))).toBe(VoicePriority.SPOTTER);
    expect(defaultVoicePriority(ev('clear'))).toBe(VoicePriority.STRATEGY);
    expect(defaultVoicePriority(ev('fuel_low', { thresholdLaps: 2 }, { tier: 1 }))).toBe(
      VoicePriority.WARNING,
    );
    expect(defaultVoicePriority(ev('fuel_low', { thresholdLaps: 4 }, { tier: 1 }))).toBe(
      VoicePriority.STRATEGY,
    );
  });

  it('routes energy_low by urgency, exactly like fuel_low (T11.5)', () => {
    expect(defaultVoicePriority(ev('energy_low', { thresholdLaps: 2 }, { tier: 1 }))).toBe(
      VoicePriority.WARNING,
    );
    expect(defaultVoicePriority(ev('energy_low', { thresholdLaps: 4 }, { tier: 1 }))).toBe(
      VoicePriority.STRATEGY,
    );
  });

  it('routes the strategy call-outs: box_this_lap is urgent, pit_window_open is a heads-up', () => {
    expect(defaultVoicePriority(ev('box_this_lap', {}, { tier: 1 }))).toBe(VoicePriority.WARNING);
    expect(defaultVoicePriority(ev('pit_window_open', {}, { tier: 2 }))).toBe(
      VoicePriority.STRATEGY,
    );
  });
});

describe('ProactiveVoiceRouter', () => {
  it('routes a reflex spotter event to its pre-rendered clip with no live synthesis', async () => {
    const { router, tts, tier0Clips, player } = await makeRouter();
    const outcome = await router.route(ev('car_right', { carId: 31 }));
    if (outcome.kind !== 'prerendered') throw new Error('expected prerendered');
    expect(outcome.clip.id).toBe(tier0Clips.get('car_right')!.id);
    expect(outcome.priority).toBe(VoicePriority.SPOTTER);
    expect(tts.synthCalls).toBe(0); // Tier-0 reflex is pre-rendered — never synthesizes
    expect(player.playing?.clip.id).toBe(tier0Clips.get('car_right')!.id);
  });

  it('a reflex call preempts chatter already playing', async () => {
    const { router, player, tier0Clips } = await makeRouter();
    player.enqueue(
      { id: 'chatter-1', label: 'a long strategy explanation' },
      VoicePriority.CHATTER,
    );
    expect(player.playing?.clip.id).toBe('chatter-1');
    await router.route(ev('car_left'));
    expect(player.playing?.clip.id).toBe(tier0Clips.get('car_left')!.id);
  });

  it('a clear release queues behind chatter — it does not preempt', async () => {
    const { router, player } = await makeRouter();
    player.enqueue({ id: 'chatter-1' }, VoicePriority.CHATTER);
    await router.route(ev('clear', { sides: ['right'] }));
    expect(player.playing?.clip.id).toBe('chatter-1'); // still playing
    expect(player.queueLength).toBe(1); // clear queued behind it
  });

  it('phrases fuel_low and speaks it (template), quoting the payload number', async () => {
    const { router, tts } = await makeRouter();
    const outcome = await router.route(
      ev('fuel_low', { lapsRemaining: 3.8, thresholdLaps: 4 }, { tier: 1 }),
    );
    if (outcome.kind !== 'spoken') throw new Error('expected spoken');
    expect(outcome.text).toContain('3');
    expect(outcome.priority).toBe(VoicePriority.STRATEGY);
    expect(outcome.clips.length).toBeGreaterThan(0);
    expect(tts.synthCalls).toBeGreaterThan(0); // the phrased path DOES synthesize
  });

  it('phrases fuel_low via an LLM provider (llmPhraser)', async () => {
    const provider = new FakeProvider([{ text: 'Fuel low, about three to go. Box soon.' }]);
    const { router } = await makeRouter({ phrase: llmPhraser(provider) });
    const outcome = await router.route(
      ev('fuel_low', { lapsRemaining: 3.2, thresholdLaps: 4 }, { tier: 1 }),
    );
    if (outcome.kind !== 'spoken') throw new Error('expected spoken');
    expect(outcome.text).toBe('Fuel low, about three to go. Box soon.');
  });

  it('skips an event with no clip and no phrase', async () => {
    const { router } = await makeRouter({ phrase: () => null });
    const outcome = await router.route(ev('strategy_update', {}, { tier: 2 }));
    expect(outcome).toEqual({
      kind: 'skipped',
      event: expect.objectContaining({ type: 'strategy_update' }),
      reason: 'no-audio',
    });
  });

  it('routeAll enqueues reflex calls before phrased ones, preserving result order', async () => {
    const { router, sink, tier0Clips } = await makeRouter();
    const events = [
      ev('fuel_low', { lapsRemaining: 3.5, thresholdLaps: 4 }, { tier: 1 }),
      ev('car_left'),
    ];
    const outcomes = await router.routeAll(events);
    expect(outcomes.map((o) => o.kind)).toEqual(['spoken', 'prerendered']); // input order kept
    // The reflex clip was enqueued first, so it started before the phrased reply.
    expect(sink.started[0]).toBe(tier0Clips.get('car_left')!.id);
  });
});

describe('synthetic arcs → right audio (real EventDetector + rules)', () => {
  const withFuelLaps = (laps: number, tick: number): RaceState => ({
    ...lowFuelState,
    tick,
    monotonicMs: lowFuelState.monotonicMs + tick,
    player: {
      ...lowFuelState.player,
      fuel: { ...lowFuelState.player.fuel, lapsRemainingEst: laps },
    },
  });

  it('a declining-fuel arc fires fuel_low and routes it to spoken audio at escalating priority', async () => {
    const { router } = await makeRouter();
    const detector = new EventDetector([fuelLowRule()]);

    const out0 = await router.routeAll(detector.process(withFuelLaps(6, 0)));
    const out1 = await router.routeAll(detector.process(withFuelLaps(3.8, 1000)));
    const out2 = await router.routeAll(detector.process(withFuelLaps(1.2, 2000)));

    expect(out0).toEqual([]); // 6 laps — above all thresholds
    expect(out1.map((o) => o.kind)).toEqual(['spoken']); // crossed the 4-lap threshold
    expect(out2.map((o) => o.kind)).toEqual(['spoken']); // crossed the 2-lap threshold

    const o1 = out1[0]!;
    const o2 = out2[0]!;
    if (o1.kind !== 'spoken' || o2.kind !== 'spoken') throw new Error('expected spoken');
    expect(o1.priority).toBe(VoicePriority.STRATEGY); // 4-lap heads-up
    expect(o2.priority).toBe(VoicePriority.WARNING); // 2-lap urgent
  });

  it('a car drawing alongside fires a reflex car_right routed to its pre-rendered clip', async () => {
    const { router, tts, tier0Clips } = await makeRouter();
    const detector = new EventDetector([spotterRule()]);

    const outcomes = await router.routeAll(detector.process(multiClassTrafficState));

    const reflex = outcomes.find((o) => o.kind === 'prerendered');
    if (!reflex || reflex.kind !== 'prerendered') throw new Error('expected a prerendered outcome');
    expect(reflex.event.type).toBe('car_right');
    expect(reflex.clip.id).toBe(tier0Clips.get('car_right')!.id);
    expect(tts.synthCalls).toBe(0); // reflex spotter audio is never synthesized live
  });
});
