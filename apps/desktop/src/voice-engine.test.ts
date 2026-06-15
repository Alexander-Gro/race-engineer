import { FakeProvider } from '@race-engineer/ai';
import { EventDetector, fuelLowRule, spotterRule, type RaceState } from '@race-engineer/core';
import { lowFuelState, multiClassTrafficState } from '@race-engineer/core/fixtures';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import {
  FakeSttProvider,
  FakeTtsProvider,
  MockAudioSink,
  MockMicSource,
  prerenderTier0,
  RadioCapture,
  VoicePriority,
  type AudioClip,
} from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import { EngineerVoice, type EngineerVoiceDeps } from './voice-engine';

const fuelPlan = computeFuelPlan({
  fuelLiters: 38,
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
});

const snapshotOf = (raceState: RaceState): EngineerSnapshot => ({
  seq: 0,
  monotonicMs: raceState.monotonicMs,
  raceState,
  strategy: { fuelPlan, stintPlan: null },
});

const makeVoice = async (
  overrides: Partial<EngineerVoiceDeps> = {},
): Promise<{
  voice: EngineerVoice;
  sink: MockAudioSink;
  tier0Clips: ReadonlyMap<string, AudioClip>;
}> => {
  const sink = new MockAudioSink();
  const tier0Clips = await prerenderTier0(new FakeTtsProvider(), 'v1');
  const voice = new EngineerVoice({
    tts: new FakeTtsProvider(),
    sink,
    tier0Clips,
    voice: 'v1',
    ...overrides,
  });
  return { voice, sink, tier0Clips };
};

const withFuelLaps = (laps: number, tick: number): RaceState => ({
  ...lowFuelState,
  tick,
  monotonicMs: lowFuelState.monotonicMs + tick,
  player: {
    ...lowFuelState.player,
    fuel: { ...lowFuelState.player.fuel, lapsRemainingEst: laps },
  },
});

describe('EngineerVoice — proactive call-outs from Core events', () => {
  it('routes a spotter event to its pre-rendered Tier-0 clip (no live synthesis)', async () => {
    const { voice, tier0Clips } = await makeVoice();
    const events = new EventDetector([spotterRule()]).process(multiClassTrafficState);

    const outcomes = await voice.routeEvents(events);

    const reflex = outcomes.find((o) => o.kind === 'prerendered');
    if (!reflex || reflex.kind !== 'prerendered') throw new Error('expected a prerendered outcome');
    expect(reflex.event.type).toBe('car_right');
    expect(reflex.clip.id).toBe(tier0Clips.get('car_right')!.id);
    expect(reflex.priority).toBe(VoicePriority.SPOTTER);
    expect(voice.player.playing?.clip.id).toBe(tier0Clips.get('car_right')!.id);
  });

  it('routes a fuel_low event to a spoken template call-out, quoting the payload number', async () => {
    const { voice } = await makeVoice();
    const detector = new EventDetector([fuelLowRule()]);

    expect(await voice.routeEvents(detector.process(withFuelLaps(6, 0)))).toEqual([]); // armed, no event
    const outcomes = await voice.routeEvents(detector.process(withFuelLaps(3.8, 1000)));

    expect(outcomes.map((o) => o.kind)).toEqual(['spoken']);
    const spoken = outcomes[0]!;
    if (spoken.kind !== 'spoken') throw new Error('expected spoken');
    expect(spoken.text).toContain('3'); // "about 3 laps left" — from the event payload
    expect(spoken.priority).toBe(VoicePriority.STRATEGY); // 4-lap heads-up, not yet urgent
  });

  it('routeEvents on an empty batch is a no-op', async () => {
    const { voice } = await makeVoice();
    expect(await voice.routeEvents([])).toEqual([]);
  });
});

describe('EngineerVoice — reactive PTT loop', () => {
  const spokenText = (clips: AudioClip[][]): string =>
    clips
      .flat()
      .map((c) => c.label)
      .join(' ');

  it('answers a PTT question from the latest snapshot, quoting the tool number (not invented)', async () => {
    const mic = new MockMicSource();
    const spoken: AudioClip[][] = [];
    const { voice } = await makeVoice({
      provider: new FakeProvider([
        { tools: [{ name: 'get_fuel_plan' }] },
        {
          text: (r) => {
            const plan = r.get_fuel_plan as { lapsRemainingOnFuel: number };
            return `Fuel's good. ${plan.lapsRemainingOnFuel.toFixed(1)} laps in the tank.`;
          },
        },
      ]),
      capture: new RadioCapture({ stt: new FakeSttProvider(), mic }),
      loopEvents: { onSpoken: (clips) => spoken.push(clips) },
    });

    voice.onSnapshot(snapshotOf(multiClassTrafficState));
    voice.onPtt(true);
    for (const w of ['how', 'is', 'my', 'fuel']) mic.emit(w);
    voice.onPtt(false);
    await voice.whenIdle();

    expect(spokenText(spoken)).toContain(fuelPlan!.lapsRemainingOnFuel.toFixed(1));
  });

  it('uses the freshest snapshot for tool context (a later snapshot wins)', async () => {
    const mic = new MockMicSource();
    const replies: string[] = [];
    const stale: RaceState = {
      ...multiClassTrafficState,
      player: { ...multiClassTrafficState.player, position: 9 },
    };
    const fresh: RaceState = {
      ...multiClassTrafficState,
      player: { ...multiClassTrafficState.player, position: 4 },
    };
    const { voice } = await makeVoice({
      provider: new FakeProvider([
        { tools: [{ name: 'get_race_state' }] },
        { text: (r) => `You're P${(r.get_race_state as { position: number }).position}.` },
      ]),
      capture: new RadioCapture({ stt: new FakeSttProvider(), mic }),
      loopEvents: { onReply: (r) => replies.push(r.text) },
    });

    voice.onSnapshot(snapshotOf(stale));
    voice.onSnapshot(snapshotOf(fresh)); // newer telemetry
    voice.onPtt(true);
    mic.emit('position');
    voice.onPtt(false);
    await voice.whenIdle();

    expect(replies).toEqual(["You're P4."]);
  });

  it('errors a turn gracefully when asked before any telemetry (no null-context read)', async () => {
    const mic = new MockMicSource();
    const errors: unknown[] = [];
    const { voice } = await makeVoice({
      provider: new FakeProvider([{ tools: [{ name: 'get_fuel_plan' }] }, { text: 'unreached' }]),
      capture: new RadioCapture({ stt: new FakeSttProvider(), mic }),
      loopEvents: { onError: (e) => errors.push(e) },
    });

    voice.onPtt(true);
    mic.emit('fuel');
    voice.onPtt(false);
    await voice.whenIdle();

    expect(errors).toHaveLength(1);
  });
});

describe('EngineerVoice — reactive half optional until wired (T4.5)', () => {
  it('builds no loop and makes onPtt a safe no-op without a provider + capture', async () => {
    const { voice } = await makeVoice();
    expect(voice.loop).toBeNull();
    expect(() => voice.onPtt(true)).not.toThrow();
    await expect(voice.whenIdle()).resolves.toBeUndefined();
  });
});
