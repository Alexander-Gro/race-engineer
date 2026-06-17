import { describe, expect, it } from 'vitest';
import { MockAudioSink } from '../backends/mock-sink';
import { VoicePlayer } from '../player';
import { FakeTtsProvider } from '../providers/fake-tts';
import { speak, splitSentences } from '../speak';
import type { VoiceDelivery } from '../tone';
import type { AudioChunk, AudioClip, TtsProvider, VoiceId } from '../types';
import { VoicePriority } from '../types';

/** A TTS that records every (text, delivery) it is asked to synthesize — to assert tone plumbing. */
class RecordingTts implements TtsProvider {
  readonly name = 'recording';
  readonly calls: { text: string; delivery?: VoiceDelivery }[] = [];
  async *synthesizeStream(
    text: string,
    _voice: VoiceId,
    delivery?: VoiceDelivery,
  ): AsyncIterable<AudioChunk> {
    this.calls.push({ text, delivery });
    yield { seq: 0, data: new Uint8Array([1]) };
  }
  async prerender(): Promise<Map<string, AudioClip>> {
    return new Map();
  }
}

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

  it('strips a leading tone tag and forwards the tone to the provider (never speaks the tag)', async () => {
    const tts = new RecordingTts();
    const player = new VoicePlayer(new MockAudioSink());
    const clips = await speak({
      player,
      tts,
      voice: 'v1',
      text: '[urgent] Box this lap. Pit entry is clear.',
    });
    // The tag is gone from the spoken clips, split per sentence...
    expect(clips.map((c) => c.label)).toEqual(['Box this lap.', 'Pit entry is clear.']);
    // ...and every sentence was synthesized with the parsed tone.
    expect(tts.calls.map((c) => c.text)).toEqual(['Box this lap.', 'Pit entry is clear.']);
    expect(tts.calls.every((c) => c.delivery?.tone === 'urgent')).toBe(true);
  });

  it('an explicit delivery overrides the inline tag', async () => {
    const tts = new RecordingTts();
    const player = new VoicePlayer(new MockAudioSink());
    await speak({
      player,
      tts,
      voice: 'v1',
      text: '[upbeat] Nice lap.',
      delivery: { tone: 'serious' },
    });
    expect(tts.calls[0]?.text).toBe('Nice lap.'); // tag still stripped from the words
    expect(tts.calls[0]?.delivery?.tone).toBe('serious'); // caller's delivery wins
  });
});
