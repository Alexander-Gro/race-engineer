import { describe, expect, it } from 'vitest';
import type { EngineerEvent, EventType } from '@race-engineer/core';
import { CalloutSpeaker, calloutForEvent, type CalloutSpeechPort } from './callout';

let seq = 0;
/** Build an event. Defaults to `tier: 1` (the speakable range); pass `tier: 0` for a reflex spotter. */
const ev = (
  type: EventType,
  priority: number,
  opts: { id?: string; tier?: 0 | 1 | 2 | 3 } = {},
): EngineerEvent => ({
  id: opts.id ?? `e${seq++}`,
  tick: 0,
  type,
  tier: opts.tier ?? 1,
  priority,
  payload: {},
});

/** A speech port that records spoken text and lets the test fire the utterance's `onDone`. */
const makePort = (): {
  port: CalloutSpeechPort;
  spoken: string[];
  cancels: () => number;
  finish: () => void;
} => {
  const spoken: string[] = [];
  let cancelCount = 0;
  let pendingDone: (() => void) | null = null;
  return {
    port: {
      speak: (text, onDone) => {
        spoken.push(text);
        pendingDone = onDone;
      },
      cancel: () => {
        cancelCount += 1;
      },
    },
    spoken,
    cancels: () => cancelCount,
    finish: () => pendingDone?.(),
  };
};

describe('calloutForEvent', () => {
  it('phrases a speakable Tier-1 event with its priority and id', () => {
    expect(calloutForEvent(ev('box_this_lap', 80, { id: 'x' }))).toEqual({
      text: 'Box this lap.',
      priority: 80,
      id: 'x',
      eventType: 'box_this_lap',
    });
  });

  it('stays silent for markers (lap_completed / flag_changed)', () => {
    expect(calloutForEvent(ev('lap_completed', 10))).toBeNull();
    expect(calloutForEvent(ev('flag_changed', 50))).toBeNull();
  });

  it('NEVER voices a Tier-0 reflex spotter call (pre-rendered VoicePlayer path only — docs/01/07)', () => {
    expect(calloutForEvent(ev('car_left', 100, { tier: 0 }))).toBeNull();
    expect(calloutForEvent(ev('three_wide', 100, { tier: 0 }))).toBeNull();
    // The guard is on tier, not just the missing phrase — a Tier-0 event of any type is rejected.
    expect(calloutForEvent(ev('fuel_low', 100, { tier: 0 }))).toBeNull();
  });
});

describe('CalloutSpeaker', () => {
  it('speaks a call-out from the event feed', () => {
    const { port, spoken } = makePort();
    new CalloutSpeaker(port).announce([ev('box_this_lap', 80)]);
    expect(spoken).toEqual(['Box this lap.']);
  });

  it('never speaks a Tier-0 spotter event even at top priority', () => {
    const { port, spoken } = makePort();
    new CalloutSpeaker(port).announce([ev('car_left', 100, { tier: 0 })]);
    expect(spoken).toEqual([]);
  });

  it('speaks the highest-priority call-out in a batch', () => {
    const { port, spoken } = makePort();
    new CalloutSpeaker(port).announce([
      ev('fuel_low', 50),
      ev('box_this_lap', 80),
      ev('blue_flag', 70),
    ]);
    expect(spoken).toEqual(['Box this lap.']);
  });

  it('preempts a lower-priority call-out in progress (the urgent one cuts in)', () => {
    const { port, spoken, cancels } = makePort();
    const speaker = new CalloutSpeaker(port);
    speaker.announce([ev('strategy_update', 50)]);
    speaker.announce([ev('box_this_lap', 80)]); // more urgent — preempts
    expect(spoken).toEqual(['Strategy update.', 'Box this lap.']);
    expect(cancels()).toBeGreaterThanOrEqual(1);
  });

  it('drops a lower-or-equal call-out that arrives while a more urgent one is speaking', () => {
    const { port, spoken } = makePort();
    const speaker = new CalloutSpeaker(port);
    speaker.announce([ev('box_this_lap', 80)]);
    speaker.announce([ev('strategy_update', 50)]); // can't preempt → dropped
    expect(spoken).toEqual(['Box this lap.']);
  });

  it('speaks the next call-out once the previous finishes', () => {
    const { port, spoken, finish } = makePort();
    const speaker = new CalloutSpeaker(port);
    speaker.announce([ev('box_this_lap', 80)]);
    finish(); // utterance ends → speaker goes idle
    speaker.announce([ev('strategy_update', 50)]);
    expect(spoken).toEqual(['Box this lap.', 'Strategy update.']);
  });

  it('does not re-speak the same emission (id dedupe — e.g. a snapshot replay)', () => {
    const { port, spoken } = makePort();
    const speaker = new CalloutSpeaker(port);
    const e = ev('fuel_low', 50, { id: 'fixed' });
    speaker.announce([e]);
    speaker.announce([e]); // same id re-delivered
    expect(spoken).toEqual(['Fuel running low.']);
  });

  it('stays silent when muted and stops anything in progress', () => {
    const { port, spoken, cancels } = makePort();
    const speaker = new CalloutSpeaker(port);
    speaker.announce([ev('box_this_lap', 80)]);
    speaker.setEnabled(false);
    expect(cancels()).toBeGreaterThanOrEqual(1); // stopped on mute
    speaker.announce([ev('pit_window_open', 50)]); // muted → silent
    expect(spoken).toEqual(['Box this lap.']);
  });

  it('is unavailable and inert with no speech device (never throws)', () => {
    const speaker = new CalloutSpeaker(null);
    expect(speaker.available).toBe(false);
    expect(speaker.enabled).toBe(false);
    expect(() => speaker.announce([ev('box_this_lap', 80)])).not.toThrow();
  });
});
