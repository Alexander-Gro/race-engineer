import { FakeProvider, type ChatMessage, type FakeStep, type RaceContext } from '@race-engineer/ai';
import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import { InputReader, MockBackend, type ButtonRef } from '@race-engineer/input';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import {
  FakeSttProvider,
  FakeTtsProvider,
  MockAudioSink,
  MockMicSource,
  RadioCapture,
  VoicePlayer,
  VoicePriority,
  type AudioClip,
} from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import { ReactiveRadioLoop, type ReactiveRadioLoopEvents } from '../loop';

const fuelPlan = computeFuelPlan({
  fuelLiters: 38,
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
});
const ctx: RaceContext = { raceState: multiClassTrafficState, fuelPlan };

interface Harness {
  loop: ReactiveRadioLoop;
  mic: MockMicSource;
  sink: MockAudioSink;
  player: VoicePlayer;
  spoken: AudioClip[][];
  replies: { text: string }[];
}

const makeHarness = (steps: FakeStep[], events?: ReactiveRadioLoopEvents): Harness => {
  const mic = new MockMicSource();
  const sink = new MockAudioSink();
  const player = new VoicePlayer(sink);
  const spoken: AudioClip[][] = [];
  const replies: { text: string }[] = [];
  const loop = new ReactiveRadioLoop({
    provider: new FakeProvider(steps),
    context: () => ctx,
    capture: new RadioCapture({ stt: new FakeSttProvider(), mic }),
    player,
    tts: new FakeTtsProvider(),
    voice: 'engineer-1',
    events: {
      onReply: (r) => replies.push(r),
      onSpoken: (clips) => spoken.push(clips),
      ...events,
    },
  });
  return { loop, mic, sink, player, spoken, replies };
};

/** Say an utterance over a full PTT cycle and resolve once the reply is spoken. */
const ask = async (h: Harness, words: string[]): Promise<void> => {
  h.loop.pttDown();
  for (const w of words) h.mic.emit(w);
  await h.loop.pttUp();
};

const spokenText = (h: Harness): string =>
  h.spoken
    .flat()
    .map((c) => c.label)
    .join(' ');

describe('ReactiveRadioLoop — scripted transcripts → correct spoken answers', () => {
  it('"how is my fuel" → get_fuel_plan → speaks the tool number (not an invented one)', async () => {
    const h = makeHarness([
      { tools: [{ name: 'get_fuel_plan' }] },
      {
        text: (r) => {
          const plan = r.get_fuel_plan as { lapsRemainingOnFuel: number };
          return `Fuel's good. ${plan.lapsRemainingOnFuel.toFixed(1)} laps in the tank.`;
        },
      },
    ]);

    await ask(h, ['how', 'is', 'my', 'fuel']);

    const expected = fuelPlan!.lapsRemainingOnFuel.toFixed(1);
    expect(h.replies[0]?.text).toContain(expected);
    // The number the driver *hears* is the tool's number.
    expect(spokenText(h)).toContain(expected);
  });

  it('"what was my last lap" → get_race_state → speaks the last-lap time', async () => {
    const h = makeHarness([
      { tools: [{ name: 'get_race_state' }] },
      {
        text: (r) => {
          const s = r.get_race_state as { lastLapS: number };
          return `Last lap ${s.lastLapS.toFixed(1)}.`;
        },
      },
    ]);

    await ask(h, ['what', 'was', 'my', 'last', 'lap']);

    expect(spokenText(h)).toContain(multiClassTrafficState.player.lastLapS!.toFixed(1));
  });

  it('"who is behind me" → get_rivals → names the car behind and its gap', async () => {
    const h = makeHarness([
      { tools: [{ name: 'get_rivals' }] },
      {
        text: (r) => {
          const rivals = r.get_rivals as {
            behind: { driverName: string; gapToPlayerS: number }[];
          };
          const car = rivals.behind[0]!;
          return `${car.driverName} is ${car.gapToPlayerS.toFixed(1)} behind.`;
        },
      },
    ]);

    await ask(h, ['who', 'is', 'behind', 'me']);

    // Nearest car behind in the fixture is "Lapper" at +0.8s.
    expect(spokenText(h)).toContain('Lapper');
    expect(spokenText(h)).toContain('0.8');
  });
});

describe('ReactiveRadioLoop — PTT plumbing', () => {
  it('passes the spoken transcript to the LLM turn', async () => {
    const transcripts: string[] = [];
    const h = makeHarness([{ text: 'copy.' }], {
      onTranscript: (t: string) => transcripts.push(t),
    });
    await ask(h, ['box', 'this', 'lap']);
    expect(transcripts).toEqual(['box this lap']);
  });

  it('barge-in: pressing PTT stops the engineer mid-reply and clears the queue', async () => {
    const h = makeHarness([{ text: 'A long strategy explanation that is still playing.' }]);
    await ask(h, ['strategy']);
    expect(h.player.playing).not.toBeNull();

    h.loop.pttDown(); // driver keys the radio again
    expect(h.player.playing).toBeNull();
    expect(h.player.queueLength).toBe(0);
    h.loop.cancel(); // tidy up the capture we just opened
  });

  it('says nothing and skips the LLM when the transcript is empty', async () => {
    const skips: string[] = [];
    const h = makeHarness([{ text: 'should not run' }], {
      onSkipped: (r: string) => skips.push(r),
    });
    h.loop.pttDown();
    const result = await h.loop.pttUp(); // no mic frames → empty transcript
    expect(result).toBeNull();
    expect(skips).toEqual(['empty']);
    expect(h.replies).toEqual([]);
    expect(h.player.playing).toBeNull();
  });

  it('keeps a rolling dialogue history and feeds it to the next turn', async () => {
    const h = makeHarness([{ text: 'First answer.' }, { text: 'Second answer.' }]);
    await ask(h, ['first', 'question']);
    await ask(h, ['second', 'question']);

    const hist = h.loop.history as ChatMessage[];
    expect(hist).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'second question' },
      { role: 'assistant', content: 'Second answer.' },
    ]);
  });

  it('drives end-to-end from an InputReader PTT edge (mock wheel button)', async () => {
    const h = makeHarness([{ text: 'P3, two seconds clear.' }]);
    const backend = new MockBackend();
    const pttButton: ButtonRef = { deviceGuid: 'mock-wheel', buttonIndex: 7 };
    let nowMs = 1000;
    const reader = new InputReader({
      backend,
      now: () => nowMs,
      events: { onPtt: (down) => h.loop.onPtt(down) },
    });
    reader.bindings.set({ action: 'ptt', button: pttButton, deviceName: 'Mock Wheel' });

    backend.press(pttButton);
    reader.poll(); // PTT down edge → capture begins
    h.mic.emit('position');
    nowMs += 50; // clear the 30 ms debounce lockout before the release edge
    backend.release(pttButton);
    reader.poll(); // PTT up edge → onPtt(false) kicks off the turn
    await h.loop.whenIdle();

    expect(spokenText(h)).toBe('P3, two seconds clear.');
    // A reply to the driver's question plays at CONVERSATION — only a safety reflex may cut it off.
    expect(h.player.playing?.priority).toBe(VoicePriority.CONVERSATION);
  });

  it('does not talk over a re-keyed question (supersede guard)', async () => {
    const skips: string[] = [];
    const h = makeHarness([{ text: 'stale answer' }], {
      onSkipped: (r: string) => skips.push(r),
    });
    h.loop.pttDown();
    h.mic.emit('first');
    const inFlight = h.loop.pttUp();
    h.loop.pttDown(); // re-key before the first turn finished speaking
    await inFlight;

    expect(skips).toContain('superseded');
    expect(h.spoken).toEqual([]); // the stale answer was never voiced
    h.loop.cancel();
  });
});
