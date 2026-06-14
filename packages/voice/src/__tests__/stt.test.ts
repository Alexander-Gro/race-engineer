import { describe, expect, it } from 'vitest';
import { MockMicSource } from '../backends/mock-mic';
import { RadioCapture } from '../capture';
import { FakeSttProvider } from '../providers/fake-stt';
import type { SttResult } from '../types';

const makeCapture = (events?: {
  onPartial?: (t: string) => void;
  onFinal?: (r: SttResult) => void;
}) => {
  const mic = new MockMicSource();
  const cap = new RadioCapture({ stt: new FakeSttProvider(), mic, events });
  return { mic, cap };
};

describe('RadioCapture (PTT → STT)', () => {
  it('transcribes a held-button utterance', async () => {
    const finals: SttResult[] = [];
    const { mic, cap } = makeCapture({ onFinal: (r) => finals.push(r) });

    cap.begin();
    expect(cap.active).toBe(true);
    expect(mic.started).toBe(true);

    mic.emit('box');
    mic.emit('this');
    mic.emit('lap');
    const result = await cap.end();

    expect(result.transcript).toBe('box this lap');
    expect(cap.active).toBe(false);
    expect(mic.started).toBe(false);
    expect(finals).toEqual([{ transcript: 'box this lap', confidence01: 1 }]);
  });

  it('streams partial transcripts as audio arrives', async () => {
    const partials: string[] = [];
    const { mic, cap } = makeCapture({ onPartial: (t) => partials.push(t) });
    cap.begin();
    mic.emit('p3');
    mic.emit('confirmed');
    await cap.end();
    expect(partials).toEqual(['p3', 'p3 confirmed']);
  });

  it('only captures while the button is held (frames outside begin/end are dropped)', async () => {
    const { mic, cap } = makeCapture();
    mic.emit('ignored'); // mic not started yet
    cap.begin();
    mic.emit('kept');
    const result = await cap.end();
    mic.emit('also-ignored'); // mic stopped
    expect(result.transcript).toBe('kept');
  });

  it('cancel discards the capture with no transcript', async () => {
    const finals: SttResult[] = [];
    const { mic, cap } = makeCapture({ onFinal: (r) => finals.push(r) });
    cap.begin();
    mic.emit('oops');
    cap.cancel();
    expect(cap.active).toBe(false);
    expect(mic.started).toBe(false);
    expect(finals).toEqual([]);
    expect((await cap.end()).transcript).toBe(''); // nothing to finalize
  });

  it('begin is idempotent; end without a capture returns empty', async () => {
    const { mic, cap } = makeCapture();
    expect((await cap.end()).transcript).toBe(''); // not active
    cap.begin();
    cap.begin(); // no-op while held
    mic.emit('one');
    expect((await cap.end()).transcript).toBe('one');
  });
});
