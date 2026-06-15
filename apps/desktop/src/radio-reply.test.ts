import { FakeSttProvider, RadioCapture } from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import { BridgedMicSource } from './mic-bridge';
import { createRadioReply, type ReplyCapture } from './radio-reply';

const frame = (word: string): Uint8Array => new TextEncoder().encode(word);

/** A fake capture whose `end()` returns a scripted transcript. */
const fakeCapture = (transcript: string): ReplyCapture & { began: boolean } => ({
  began: false,
  begin(): void {
    this.began = true;
  },
  end(): Promise<{ transcript: string }> {
    return Promise.resolve({ transcript });
  },
});

describe('createRadioReply', () => {
  it('PTT down bargeIns + opens capture; up → answer the transcript → speak the reply', async () => {
    const capture = fakeCapture('how is my fuel');
    const order: string[] = [];
    const reply = createRadioReply({
      capture,
      answer: (q) => Promise.resolve(`you asked: ${q}`),
      speak: (t) => order.push(`speak:${t}`),
      bargeIn: () => order.push('bargeIn'),
      onEvent: (e) => order.push(`${e.kind}:${e.text}`),
    });

    reply.onPtt(true);
    expect(capture.began).toBe(true);
    expect(order).toEqual(['bargeIn']);

    reply.onPtt(false);
    await reply.whenIdle();

    expect(order).toEqual([
      'bargeIn',
      'heard:how is my fuel',
      'reply:you asked: how is my fuel',
      'speak:you asked: how is my fuel',
    ]);
  });

  it('a released-without-speaking (empty transcript) turn answers + speaks nothing', async () => {
    const spoken: string[] = [];
    let answered = false;
    const reply = createRadioReply({
      capture: fakeCapture('   '),
      answer: () => {
        answered = true;
        return Promise.resolve('unused');
      },
      speak: (t) => spoken.push(t),
      bargeIn: () => {},
    });

    reply.onPtt(true);
    reply.onPtt(false);
    await reply.whenIdle();

    expect(answered).toBe(false);
    expect(spoken).toEqual([]);
  });

  it('an empty reply is not spoken (no silent clip enqueued)', async () => {
    const spoken: string[] = [];
    const reply = createRadioReply({
      capture: fakeCapture('hello'),
      answer: () => Promise.resolve(''), // provider/template produced nothing
      speak: (t) => spoken.push(t),
      bargeIn: () => {},
    });

    reply.onPtt(true);
    reply.onPtt(false);
    await reply.whenIdle();

    expect(spoken).toEqual([]);
  });

  it('an answer that rejects never breaks the chain (whenIdle still resolves)', async () => {
    const reply = createRadioReply({
      capture: fakeCapture('hello'),
      answer: () => Promise.reject(new Error('provider down')),
      speak: () => {},
      bargeIn: () => {},
    });

    reply.onPtt(true);
    reply.onPtt(false);
    await expect(reply.whenIdle()).resolves.toBeUndefined();
  });

  it('round trip through a real RadioCapture(FakeStt) + BridgedMicSource', async () => {
    const mic = new BridgedMicSource();
    const capture = new RadioCapture({ stt: new FakeSttProvider(), mic });
    const spoken: string[] = [];
    const reply = createRadioReply({
      capture,
      answer: (q) => Promise.resolve(`heard ${q}`),
      speak: (t) => spoken.push(t),
      bargeIn: () => {},
    });

    reply.onPtt(true);
    for (const w of ['box', 'this', 'lap']) mic.handleFrame(frame(w));
    reply.onPtt(false);
    await reply.whenIdle();

    expect(spoken).toEqual(['heard box this lap']);
  });
});
