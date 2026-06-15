import { describe, expect, it, vi } from 'vitest';
import { SpeechController, type SpeechPort } from './speech';

/** A SpeechPort that records the call order so we can assert cancel-before-speak (barge-in). */
const recordingPort = (): SpeechPort & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    speak: (text) => calls.push(`speak:${text}`),
    cancel: () => calls.push('cancel'),
  };
};

describe('SpeechController', () => {
  it('speaks a reply, cancelling any current speech first (barge-in)', () => {
    const port = recordingPort();
    new SpeechController(port).say('Fuel is good, 8 laps left.');
    expect(port.calls).toEqual(['cancel', 'speak:Fuel is good, 8 laps left.']);
  });

  it('trims and skips blank text', () => {
    const port = recordingPort();
    const c = new SpeechController(port);
    c.say('   ');
    c.say('');
    expect(port.calls).toEqual([]);
    c.say('  P4.  ');
    expect(port.calls).toEqual(['cancel', 'speak:P4.']);
  });

  it('says nothing while muted, and muting stops in-progress speech', () => {
    const port = recordingPort();
    const c = new SpeechController(port, { enabled: false });
    expect(c.enabled).toBe(false);
    c.say('should not speak');
    expect(port.calls).toEqual([]);

    c.setEnabled(true);
    c.say('now audible');
    expect(port.calls).toEqual(['cancel', 'speak:now audible']);

    c.setEnabled(false); // muting cancels whatever is talking
    expect(port.calls).toEqual(['cancel', 'speak:now audible', 'cancel']);
  });

  it('degrades to a safe no-op when no speech device is available', () => {
    const c = new SpeechController(null);
    expect(c.available).toBe(false);
    expect(c.enabled).toBe(false);
    expect(() => {
      c.say('hello');
      c.stop();
      c.setEnabled(true); // cannot enable without a port
    }).not.toThrow();
    expect(c.enabled).toBe(false);
  });

  it('stop() cancels in-progress speech', () => {
    const cancel = vi.fn();
    new SpeechController({ speak: vi.fn(), cancel }).stop();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
