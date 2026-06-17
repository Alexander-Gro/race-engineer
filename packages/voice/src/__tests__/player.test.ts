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

  it('preempts the current utterance when a clip meets a configured urgentThreshold (opt-in)', () => {
    // Preemption is off by default now; a deployment can opt back in with a finite urgentThreshold.
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink, { urgentThreshold: VoicePriority.WARNING });
    player.enqueue(clip('long-strategy'), VoicePriority.STRATEGY);
    player.enqueue(clip('urgent'), VoicePriority.WARNING);

    expect(sink.started).toEqual(['long-strategy', 'urgent']);
    expect(sink.stopped).toEqual(['long-strategy']); // cut off, not queued behind
    expect(player.playing?.clip.id).toBe('urgent');
  });

  it('does not preempt by priority alone with the default (unreachable) threshold', () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    player.enqueue(clip('strategy'), VoicePriority.STRATEGY);
    player.enqueue(clip('warning'), VoicePriority.WARNING); // higher, but nothing preempts by default
    expect(sink.started).toEqual(['strategy']); // strategy keeps playing
    expect(sink.stopped).toEqual([]);
    expect(player.queueLength).toBe(1); // warning queued ahead, plays next
  });

  it('a generic call-out never cuts off a driver reply — it queues behind it', () => {
    // The reported bug: ask a question, then a "box this lap"/"fuel low" fires and chops the answer.
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    player.enqueue(clip('reply'), VoicePriority.CONVERSATION); // the engineer is answering
    player.enqueue(clip('box-this-lap'), VoicePriority.WARNING); // urgent call-out fires mid-answer

    expect(sink.started).toEqual(['reply']); // the answer keeps playing — not cut
    expect(sink.stopped).toEqual([]);
    sink.finishCurrent();
    expect(sink.started).toEqual(['reply', 'box-this-lap']); // then the call-out, in full
  });

  it('a reply stays ahead of call-outs queued while it speaks (no interleaving)', () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    player.enqueue(clip('reply-1'), VoicePriority.CONVERSATION); // sentence 1 of the answer (playing)
    player.enqueue(clip('reply-2'), VoicePriority.CONVERSATION); // sentence 2 (queued)
    player.enqueue(clip('warning'), VoicePriority.WARNING); // call-out fires during the answer
    player.enqueue(clip('strategy'), VoicePriority.STRATEGY);

    sink.finishCurrent(); // reply-1 done
    sink.finishCurrent(); // reply-2 done — the answer finishes before any call-out
    sink.finishCurrent(); // warning
    expect(sink.started).toEqual(['reply-1', 'reply-2', 'warning', 'strategy']);
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
    player.enqueue(clip('b'), VoicePriority.WARNING, { preempt: true }); // explicit preempt
    sink.finishCurrent(); // b ends
    expect(events).toEqual(['start:a', 'preempt:a', 'start:b', 'end:b']);
  });
});
