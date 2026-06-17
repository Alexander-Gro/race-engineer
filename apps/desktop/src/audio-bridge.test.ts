import {
  MockAudioSink,
  VoicePlayer,
  VoicePriority,
  type AudioClip,
  type AudioSink,
  type PlaybackHandle,
} from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import {
  createAudioReceiver,
  IpcAudioSink,
  type AudioEndedMessage,
  type AudioOutMessage,
} from './audio-bridge';

const clip = (id: string, audio?: Uint8Array): AudioClip =>
  audio ? { id, audio: { data: audio } } : { id };

describe('IpcAudioSink — worker side', () => {
  it('posts a play command with a unique pid and forwards the clip + volume', () => {
    const posted: AudioOutMessage[] = [];
    const sink = new IpcAudioSink((m) => posted.push(m));

    sink.play(clip('a', new Uint8Array([1, 2, 3])), { volume: 0.8, onEnded: () => {} });
    sink.play(clip('a'), { volume: 0.8, onEnded: () => {} }); // same clip id, must get a new pid

    expect(posted).toHaveLength(2);
    expect(posted[0]).toMatchObject({ kind: 'play', pid: 0, volume: 0.8 });
    expect(posted[1]).toMatchObject({ kind: 'play', pid: 1 });
    // The synthesized bytes ride along on the clip (structured-clone-safe over the IPC).
    expect((posted[0] as { clip: AudioClip }).clip.audio?.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('fires onEnded only for the matching pid when the renderer reports a natural end', () => {
    const posted: AudioOutMessage[] = [];
    const sink = new IpcAudioSink((m) => posted.push(m));
    const ended: string[] = [];
    sink.play(clip('a'), { volume: 1, onEnded: () => ended.push('a') });
    sink.play(clip('b'), { volume: 1, onEnded: () => ended.push('b') });

    sink.handleEnded(1); // b finished
    expect(ended).toEqual(['b']);
    sink.handleEnded(0); // a finished
    expect(ended).toEqual(['b', 'a']);
    sink.handleEnded(0); // duplicate / stale → ignored
    expect(ended).toEqual(['b', 'a']);
  });

  it('stop() posts a stop and suppresses a late ended (no onEnded after a preempt/barge-in)', () => {
    const posted: AudioOutMessage[] = [];
    const sink = new IpcAudioSink((m) => posted.push(m));
    const ended: string[] = [];
    const handle = sink.play(clip('a'), { volume: 1, onEnded: () => ended.push('a') });

    handle.stop();
    expect(posted).toContainEqual({ kind: 'stop', pid: 0 });
    sink.handleEnded(0); // a late natural-end after stop must NOT fire onEnded
    expect(ended).toEqual([]);

    // A second stop is a no-op (the pid is already gone).
    const before = posted.length;
    handle.stop();
    expect(posted).toHaveLength(before);
  });

  it('forwards setVolume per pid and setOutputDevice', () => {
    const posted: AudioOutMessage[] = [];
    const sink = new IpcAudioSink((m) => posted.push(m));
    const handle = sink.play(clip('a'), { volume: 1, onEnded: () => {} });
    handle.setVolume(0.3);
    sink.setOutputDevice('device-7');
    expect(posted).toContainEqual({ kind: 'volume', pid: 0, volume: 0.3 });
    expect(posted).toContainEqual({ kind: 'device', deviceId: 'device-7' });
  });
});

describe('createAudioReceiver — renderer side', () => {
  it('plays on the backend and posts ended back per pid on natural completion', () => {
    const backend = new MockAudioSink();
    const endedBack: AudioEndedMessage[] = [];
    const receive = createAudioReceiver(backend, (m) => endedBack.push(m));

    receive({ kind: 'play', pid: 5, clip: clip('a'), volume: 0.5 });
    expect(backend.started).toEqual(['a']);

    backend.finishCurrent(); // the backend reports natural completion
    expect(endedBack).toEqual([{ pid: 5 }]);
  });

  it('stops the right playback and posts no ended (a stop is a preempt, not a completion)', () => {
    const backend = new MockAudioSink();
    const endedBack: AudioEndedMessage[] = [];
    const receive = createAudioReceiver(backend, (m) => endedBack.push(m));

    receive({ kind: 'play', pid: 1, clip: clip('a'), volume: 1 });
    receive({ kind: 'stop', pid: 1 });
    expect(backend.stopped).toEqual(['a']);
    expect(endedBack).toEqual([]);
    // A stop for an unknown pid is a no-op.
    expect(() => receive({ kind: 'stop', pid: 99 })).not.toThrow();
  });

  it('ignores a voice-active status message (it is handled by the renderer, not the audio backend)', () => {
    const backend = new MockAudioSink();
    const endedBack: AudioEndedMessage[] = [];
    const receive = createAudioReceiver(backend, (m) => endedBack.push(m));
    expect(() => receive({ kind: 'voice-active', active: true })).not.toThrow();
    expect(backend.started).toEqual([]); // no playback triggered
    expect(endedBack).toEqual([]);
  });

  it('routes volume + output-device commands to the backend', () => {
    const calls: string[] = [];
    const backend: AudioSink = {
      play: (): PlaybackHandle => ({
        stop: () => {},
        setVolume: (v) => calls.push(`vol:${v}`),
      }),
      setOutputDevice: (id) => calls.push(`device:${id}`),
    };
    const receive = createAudioReceiver(backend, () => {});
    receive({ kind: 'play', pid: 1, clip: clip('a'), volume: 1 });
    receive({ kind: 'volume', pid: 1, volume: 0.2 });
    receive({ kind: 'device', deviceId: 'd1' });
    expect(calls).toEqual(['vol:0.2', 'device:d1']);
  });
});

describe('IpcAudioSink ↔ receiver — round trip through a real VoicePlayer', () => {
  it('drains the queue across the bridge: a clip ends in the renderer → the next one plays', () => {
    // Wire the worker sink to a renderer receiver backed by a MockAudioSink (the "renderer").
    const rendererBackend = new MockAudioSink();
    let receive: (msg: AudioOutMessage) => void = () => {};
    const sink = new IpcAudioSink((m) => receive(m));
    receive = createAudioReceiver(rendererBackend, (m) => sink.handleEnded(m.pid));

    const player = new VoicePlayer(sink);
    player.enqueue(clip('first'), VoicePriority.CHATTER);
    player.enqueue(clip('second'), VoicePriority.CHATTER);

    // First plays in the renderer; second is queued behind it.
    expect(rendererBackend.started).toEqual(['first']);
    expect(player.queueLength).toBe(1);

    // The renderer finishes the first clip → ended flows back → the queue pumps the second.
    rendererBackend.finishCurrent();
    expect(rendererBackend.started).toEqual(['first', 'second']);
    expect(player.queueLength).toBe(0);
  });

  it('an explicit preempt cuts off chatter across the bridge (stop + new play)', () => {
    const rendererBackend = new MockAudioSink();
    let receive: (msg: AudioOutMessage) => void = () => {};
    const sink = new IpcAudioSink((m) => receive(m));
    receive = createAudioReceiver(rendererBackend, (m) => sink.handleEnded(m.pid));

    const player = new VoicePlayer(sink);
    player.enqueue(clip('chatter'), VoicePriority.CHATTER);
    player.enqueue(clip('urgent'), VoicePriority.WARNING, { preempt: true }); // explicit interrupt

    expect(rendererBackend.stopped).toEqual(['chatter']);
    expect(rendererBackend.started).toEqual(['chatter', 'urgent']);
    expect(player.playing?.clip.id).toBe('urgent');
  });
});
