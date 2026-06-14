import { describe, expect, it } from 'vitest';
import { MockAudioSink } from '../backends/mock-sink';
import { VoicePlayer } from '../player';
import { VoicePriority } from '../types';

const clip = (id: string) => ({ id, label: id });

describe('VoicePlayer', () => {
  it('plays a clip and drains when it ends', () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    player.enqueue(clip('a'), VoicePriority.CHATTER);
    expect(sink.started).toEqual(['a']);
    expect(player.playing?.clip.id).toBe('a');
    sink.finishCurrent();
    expect(player.playing).toBeNull();
    expect(player.queueLength).toBe(0);
  });

  it('queues non-urgent items and plays them in priority order (no mid-sentence preempt)', () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    player.enqueue(clip('chatter1'), VoicePriority.CHATTER);
    player.enqueue(clip('strategy'), VoicePriority.STRATEGY); // higher, but below urgent threshold
    player.enqueue(clip('chatter2'), VoicePriority.CHATTER);

    expect(sink.started).toEqual(['chatter1']); // strategy did NOT cut off chatter1
    sink.finishCurrent();
    expect(sink.started).toEqual(['chatter1', 'strategy']); // then highest-priority queued
    sink.finishCurrent();
    expect(sink.started).toEqual(['chatter1', 'strategy', 'chatter2']);
  });

  it('an urgent spotter call preempts a lower-priority utterance', () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    player.enqueue(clip('long-strategy'), VoicePriority.STRATEGY);
    player.enqueue(clip('car_left'), VoicePriority.SPOTTER);

    expect(sink.started).toEqual(['long-strategy', 'car_left']);
    expect(sink.stopped).toEqual(['long-strategy']); // never stepped on by being queued — it was cut
    expect(player.playing?.clip.id).toBe('car_left');
  });

  it('does not preempt for an equal or sub-threshold priority', () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    player.enqueue(clip('s1'), VoicePriority.STRATEGY);
    player.enqueue(clip('s2'), VoicePriority.STRATEGY);
    expect(sink.started).toEqual(['s1']);
    expect(sink.stopped).toEqual([]);
    expect(player.queueLength).toBe(1);
  });

  it('barge-in stops the current utterance and clears the queue', () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    player.enqueue(clip('reply'), VoicePriority.CHATTER);
    player.enqueue(clip('more'), VoicePriority.CHATTER);
    player.bargeInStop();
    expect(sink.stopped).toContain('reply');
    expect(player.playing).toBeNull();
    expect(player.queueLength).toBe(0);
  });

  it('honors an explicit preempt flag even for lower priority', () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    player.enqueue(clip('a'), VoicePriority.STRATEGY);
    player.enqueue(clip('b'), VoicePriority.CHATTER, { preempt: true });
    expect(sink.started).toEqual(['a', 'b']);
    expect(sink.stopped).toEqual(['a']);
  });

  it('routes output-device selection to the sink', () => {
    const sink = new MockAudioSink();
    new VoicePlayer(sink).setOutputDevice('headset');
    expect(sink.outputDevice).toBe('headset');
  });

  it('fires lifecycle events', () => {
    const sink = new MockAudioSink();
    const events: string[] = [];
    const player = new VoicePlayer(sink, {
      events: {
        onStart: (c) => events.push(`start:${c.id}`),
        onEnded: (c) => events.push(`end:${c.id}`),
        onPreempted: (c) => events.push(`preempt:${c.id}`),
      },
    });
    player.enqueue(clip('a'), VoicePriority.STRATEGY);
    player.enqueue(clip('spot'), VoicePriority.SPOTTER); // preempts a
    sink.finishCurrent(); // spot ends
    expect(events).toEqual(['start:a', 'preempt:a', 'start:spot', 'end:spot']);
  });
});
