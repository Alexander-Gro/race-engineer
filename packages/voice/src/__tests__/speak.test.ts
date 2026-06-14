import { describe, expect, it } from 'vitest';
import { MockAudioSink } from '../backends/mock-sink';
import { VoicePlayer } from '../player';
import { FakeTtsProvider } from '../providers/fake-tts';
import { speak, splitSentences } from '../speak';
import { VoicePriority } from '../types';

describe('splitSentences', () => {
  it('splits a reply into sentences, keeping terminal punctuation', () => {
    expect(splitSentences('Fuel is good. You have fourteen laps. No saving needed.')).toEqual([
      'Fuel is good.',
      'You have fourteen laps.',
      'No saving needed.',
    ]);
  });

  it('returns the whole string when there is no sentence break, and [] for empty', () => {
    expect(splitSentences('box this lap')).toEqual(['box this lap']);
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('speak (sentence-streamed TTS → VoicePlayer)', () => {
  it('synthesizes each sentence and enqueues it; first sentence plays immediately', async () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    const clips = await speak({
      player,
      tts: new FakeTtsProvider(),
      voice: 'engineer-1',
      text: 'Fuel is good. Fourteen laps in the tank.',
    });

    // Each sentence became one spoken clip (labelled with what was said).
    expect(clips.map((c) => c.label)).toEqual(['Fuel is good.', 'Fourteen laps in the tank.']);
    // The first started playing; the second is queued behind it (CHATTER priority).
    expect(sink.started).toEqual([clips[0]?.id]);
    expect(player.queueLength).toBe(1);
    expect(player.playing?.priority).toBe(VoicePriority.CHATTER);

    // Draining the queue plays them in order.
    sink.finishCurrent();
    expect(sink.started).toEqual([clips[0]?.id, clips[1]?.id]);
  });

  it('stops before the next sentence when shouldStop flips (barge-in)', async () => {
    const sink = new MockAudioSink();
    const player = new VoicePlayer(sink);
    let stop = false;
    const clips = await speak({
      player,
      tts: new FakeTtsProvider(),
      voice: 'v1',
      text: 'First sentence. Second sentence. Third sentence.',
      shouldStop: () => stop,
    });
    // shouldStop is false throughout this call, so all three speak.
    expect(clips).toHaveLength(3);

    stop = true;
    const none = await speak({
      player,
      tts: new FakeTtsProvider(),
      voice: 'v1',
      text: 'Should not be spoken.',
      shouldStop: () => stop,
    });
    expect(none).toEqual([]);
  });
});
