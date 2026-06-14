import { describe, expect, it } from 'vitest';
import { LmuAdapter, lmuAdapter } from '../adapter';
import type { ShmReader } from '../shm/reader';
import type { RawScoringInfo, ScoringFrame, TelemetryFrame } from '../shm/structs';
import type { LmuRawFrame } from '../types';

const scoringInfo = (): RawScoringInfo => ({
  trackName: 'Circuit de la Sarthe',
  session: 5,
  currentET: 100,
  endET: 0,
  maxLaps: 0,
  trackLengthM: 13624,
  numVehicles: 1,
  gamePhase: 5,
  yellowFlagState: 0,
  sectorFlag: [0, 0, 0],
  ambientTempC: 22,
  trackTempC: 43,
});

const scoringFrame = (): ScoringFrame => ({ info: scoringInfo(), vehicles: [] });
const telemetryFrame = (): TelemetryFrame => ({ numVehicles: 0, vehicles: [] });

interface TrackedReader extends ShmReader {
  closeCount: number;
}

/** A fake reader for off-Windows tests — no koffi, no live game. */
const makeReader = (readScoring: () => ScoringFrame | null): TrackedReader => {
  const reader: TrackedReader = {
    closeCount: 0,
    available: { telemetry: true, scoring: true },
    readScoring,
    readTelemetry: (): TelemetryFrame | null => telemetryFrame(),
    close: (): void => {
      reader.closeCount += 1;
    },
  };
  return reader;
};

describe('LmuAdapter', () => {
  it('reports read-only shared-memory capabilities', () => {
    const caps = lmuAdapter().capabilities();
    expect(caps.hasSharedMemory).toBe(true);
    expect(caps.hasRestApi).toBe(false);
    expect(caps.readsCurrentAids).toBe(false); // SHM gives brake bias only
    expect(caps.exposesTireCompound).toBe(true);
    expect(caps.fields.has('cars')).toBe(true);
  });

  it('polls the reader and emits raw frames until stopped, then closes the reader', async () => {
    let clock = 1000;
    const reader = makeReader(() => scoringFrame());
    const adapter = new LmuAdapter({
      hz: 1000,
      openReader: () => reader,
      now: () => (clock += 10),
    });
    const received: LmuRawFrame[] = [];
    adapter.onFrame((f) => {
      received.push(f);
      if (received.length >= 3) void adapter.stop();
    });

    await adapter.start();

    expect(received).toHaveLength(3);
    expect(received.map((f) => f.tick)).toEqual([0, 1, 2]);
    expect(received[0]?.monotonicMs).toBe(1010);
    expect(received[0]?.scoring.info.trackName).toBe('Circuit de la Sarthe');
    expect(reader.closeCount).toBe(1);
  });

  it('emits nothing while scoring is unavailable (game not in a session)', async () => {
    const reader = makeReader(() => null);
    const adapter = new LmuAdapter({ hz: 1000, openReader: () => reader });
    const received: LmuRawFrame[] = [];
    adapter.onFrame((f) => received.push(f));

    setTimeout(() => void adapter.stop(), 10);
    await adapter.start();

    expect(received).toHaveLength(0);
    expect(reader.closeCount).toBe(1);
  });

  it('emits with telemetry=null when only scoring decoded that tick', async () => {
    const reader = makeReader(() => scoringFrame());
    reader.readTelemetry = () => null;
    const adapter = new LmuAdapter({ hz: 1000, openReader: () => reader });
    const received: LmuRawFrame[] = [];
    adapter.onFrame((f) => {
      received.push(f);
      if (received.length >= 1) void adapter.stop();
    });

    await adapter.start();

    expect(received[0]?.telemetry).toBeNull();
  });

  it('stop() is idempotent and unsubscribe halts delivery', async () => {
    const reader = makeReader(() => scoringFrame());
    const adapter = new LmuAdapter({ hz: 1000, openReader: () => reader });
    let count = 0;
    const unsub = adapter.onFrame(() => {
      count += 1;
      if (count >= 2) void adapter.stop();
    });

    await adapter.start();
    unsub();
    await adapter.stop(); // already stopped — no throw

    expect(count).toBe(2);
  });
});
