import { FakeSttProvider, RadioCapture, type SttResult } from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import { BridgedMicSource, createRadioInput, type MicCaptureBackend } from './mic-bridge';

const frame = (word: string): Uint8Array => new TextEncoder().encode(word);

/** A mock mic capture that records start/stop and lets a test emit frames while running. */
const mockCapture = (): {
  backend: MicCaptureBackend;
  calls: string[];
  emit: (word: string) => void;
} => {
  let onFrame: ((f: Uint8Array) => void) | null = null;
  const calls: string[] = [];
  return {
    backend: {
      start: (cb) => {
        calls.push('start');
        onFrame = cb;
      },
      stop: () => {
        calls.push('stop');
        onFrame = null;
      },
    },
    calls,
    emit: (word: string) => onFrame?.(frame(word)),
  };
};

describe('BridgedMicSource — worker side', () => {
  it('routes frames to the active capture only between start and stop (PTT gating)', () => {
    const mic = new BridgedMicSource();
    const got: string[] = [];

    mic.handleFrame(frame('dropped')); // before start → dropped
    mic.start((f) => got.push(new TextDecoder().decode(f)));
    mic.handleFrame(frame('one'));
    mic.handleFrame(frame('two'));
    mic.stop();
    mic.handleFrame(frame('after')); // after stop → dropped

    expect(got).toEqual(['one', 'two']);
  });
});

describe('createRadioInput — renderer side', () => {
  it('pttDown starts capture + emits the down edge; frames are forwarded; pttUp stops + emits up', () => {
    const cap = mockCapture();
    const frames: string[] = [];
    const edges: boolean[] = [];
    const radio = createRadioInput({
      capture: cap.backend,
      postFrame: (f) => frames.push(new TextDecoder().decode(f)),
      postPtt: (down) => edges.push(down),
    });

    radio.pttDown();
    cap.emit('hello');
    cap.emit('engineer');
    radio.pttUp();

    expect(cap.calls).toEqual(['start', 'stop']);
    expect(edges).toEqual([true, false]);
    expect(frames).toEqual(['hello', 'engineer']);
  });

  it('is idempotent: a repeat down (or up) while already in that state is ignored', () => {
    const cap = mockCapture();
    const edges: boolean[] = [];
    const radio = createRadioInput({
      capture: cap.backend,
      postFrame: () => {},
      postPtt: (down) => edges.push(down),
    });

    radio.pttDown();
    radio.pttDown(); // key-repeat / double event → ignored
    radio.pttUp();
    radio.pttUp(); // ignored

    expect(cap.calls).toEqual(['start', 'stop']);
    expect(edges).toEqual([true, false]);
  });
});

describe('mic-in round trip: renderer capture → worker RadioCapture(FakeStt) → transcript', () => {
  it('a held-button utterance transcribes through the bridged mic', async () => {
    // Worker side: a RadioCapture fed by the BridgedMicSource + a deterministic STT.
    const mic = new BridgedMicSource();
    const capture = new RadioCapture({ stt: new FakeSttProvider(), mic });

    // Renderer side: a mock mic whose frames are shipped to the worker's BridgedMicSource (the IPC hop
    // inlined as `mic.handleFrame`). A holder keeps the end() promise out of callback narrowing.
    const cap = mockCapture();
    const out: { ended: Promise<SttResult> } = { ended: Promise.resolve({ transcript: '' }) };
    const radio = createRadioInput({
      capture: cap.backend,
      postFrame: (f) => mic.handleFrame(f),
      // The PTT edges drive the worker's capture lifecycle (down → begin, up → end).
      postPtt: (down) => {
        if (down) capture.begin();
        else out.ended = capture.end();
      },
    });

    radio.pttDown();
    expect(capture.active).toBe(true);
    cap.emit('box'); // the driver speaks while holding…
    cap.emit('this');
    cap.emit('lap');
    radio.pttUp();

    // The transcript is assembled from the streamed frames (FakeStt joins decoded words).
    expect((await out.ended).transcript).toBe('box this lap');
  });
});
