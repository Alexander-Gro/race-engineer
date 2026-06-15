import { describe, expect, it } from 'vitest';
import { InputReader, MockBackend, type ButtonRef } from '@race-engineer/input';
import {
  formatPttBinding,
  PttMapper,
  type MapperScheduler,
  type PttMapperOptions,
  type PttMappingEvent,
} from './ptt-mapping';

const PTT: ButtonRef = { deviceGuid: 'mock-wheel', buttonIndex: 4 };

/** A scheduler that never fires — tests drive the listen loop by calling `mapper.poll()` directly. */
const manualScheduler: MapperScheduler = {
  setInterval: () => 0,
  clearInterval: () => undefined,
};

const makeClock = (): { now: () => number; advance: (ms: number) => void } => {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
};

/** The production `openReader` shape, but over a `MockBackend` — exercises the real `InputReader`. */
const readerOver =
  (backend: MockBackend): PttMapperOptions['openReader'] =>
  (onMapped) => {
    const reader = new InputReader({ backend, events: { onMapped } });
    reader.beginMapping('ptt');
    return {
      poll: () => reader.poll(),
      close: () => {
        reader.cancelMapping();
        reader.stop();
      },
    };
  };

const setup = (
  overrides: Partial<PttMapperOptions> = {},
): {
  backend: MockBackend;
  events: PttMappingEvent[];
  captured: ButtonRef[];
  clock: ReturnType<typeof makeClock>;
  mapper: PttMapper;
} => {
  const backend = new MockBackend();
  const events: PttMappingEvent[] = [];
  const captured: ButtonRef[] = [];
  const clock = makeClock();
  const mapper = new PttMapper({
    openReader: readerOver(backend),
    onCaptured: (b) => captured.push(b),
    emit: (e) => events.push(e),
    now: clock.now,
    scheduler: manualScheduler,
    timeoutMs: 10_000,
    ...overrides,
  });
  return { backend, events, captured, clock, mapper };
};

describe('formatPttBinding', () => {
  it('labels an unmapped button', () => {
    expect(formatPttBinding(null)).toBe('Unmapped');
  });

  it('prefers the device name when known', () => {
    expect(formatPttBinding(PTT, 'Fanatec CSL DD')).toBe('Fanatec CSL DD · button 4');
  });

  it('falls back to the device GUID when no name is known (e.g. after reload)', () => {
    expect(formatPttBinding(PTT)).toBe('mock-wheel · button 4');
  });
});

describe('PttMapper', () => {
  it('emits listening when capture is armed', async () => {
    const { mapper, events } = setup();
    await mapper.begin();
    expect(mapper.listening).toBe(true);
    expect(events).toEqual([{ type: 'listening' }]);
  });

  it('captures the first pressed button, persists it, and resolves the device name', async () => {
    const { mapper, events, captured, backend } = setup();
    await mapper.begin();

    backend.press(PTT);
    mapper.poll();

    expect(captured).toEqual([PTT]); // persisted via onCaptured
    expect(events).toEqual([
      { type: 'listening' },
      { type: 'captured', deviceGuid: 'mock-wheel', buttonIndex: 4, deviceName: 'Mock Wheel' },
    ]);
    expect(mapper.listening).toBe(false); // listening stops once bound
  });

  it('stops listening after a capture — a later press binds nothing', async () => {
    const { mapper, captured, backend } = setup();
    await mapper.begin();
    backend.press(PTT);
    mapper.poll();

    backend.release(PTT);
    mapper.poll();
    backend.press({ deviceGuid: 'mock-wheel', buttonIndex: 9 });
    mapper.poll();

    expect(captured).toEqual([PTT]); // only the first press was captured
  });

  it('cancels on request without binding', async () => {
    const { mapper, events, captured } = setup();
    await mapper.begin();
    mapper.cancel();

    expect(captured).toEqual([]);
    expect(events).toEqual([{ type: 'listening' }, { type: 'cancelled', reason: 'user' }]);
    expect(mapper.listening).toBe(false);
  });

  it('gives up after the timeout with nothing pressed', async () => {
    const { mapper, events, clock } = setup();
    await mapper.begin();

    clock.advance(9_999);
    mapper.poll(); // still within the window
    expect(mapper.listening).toBe(true);

    clock.advance(1);
    mapper.poll(); // crosses the 10 s window
    expect(events.at(-1)).toEqual({ type: 'cancelled', reason: 'timeout' });
    expect(mapper.listening).toBe(false);
  });

  it('reports an error (never throws) when the reader cannot be opened', async () => {
    const { mapper, events } = setup({
      openReader: () => {
        throw new Error('SDL2.dll not found');
      },
    });
    await mapper.begin();

    expect(mapper.listening).toBe(false);
    expect(events).toEqual([{ type: 'error', message: 'SDL2.dll not found' }]);
  });

  it('ignores a second begin while already listening (one attempt at a time)', async () => {
    const { mapper, events } = setup();
    await mapper.begin();
    await mapper.begin();
    expect(events).toEqual([{ type: 'listening' }]); // not two
  });
});
