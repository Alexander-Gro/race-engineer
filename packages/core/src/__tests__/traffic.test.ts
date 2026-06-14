import { describe, expect, it } from 'vitest';
import { EventDetector, trafficForecast, trafficRule } from '../events';
import type { EngineerEvent, RaceState } from '../schema';
import { makeCarState, makePlayerCar, multiClassTrafficState, raceStartState } from '../fixtures';

interface RivalSpec {
  id: number;
  gapToPlayerS: number | null;
  gapToPlayerM?: number | null;
  closingRateMps: number | null;
  className?: string | null;
}

/** A frame with an LMP2 player and the given rivals, for the constructed cases. */
const buildFrame = (opts: {
  tick?: number;
  monotonicMs?: number;
  playerInPit?: boolean;
  rivals: RivalSpec[];
}): RaceState => {
  const player = makePlayerCar({
    id: 99,
    position: 5,
    className: 'LMP2',
    pit: { inPitLane: opts.playerInPit ?? false, inPitStall: false, stops: 0, state: 'none' },
  });
  const rivals = opts.rivals.map((r, i) =>
    makeCarState({
      id: r.id,
      position: 6 + i,
      className: r.className === undefined ? 'Hypercar' : r.className,
      driverName: `R${r.id}`,
      gapToPlayerS: r.gapToPlayerS,
      gapToPlayerM: r.gapToPlayerM ?? null,
      closingRateMps: r.closingRateMps,
    }),
  );
  return {
    ...raceStartState,
    tick: opts.tick ?? 0,
    monotonicMs: opts.monotonicMs ?? 0,
    player,
    cars: [player, ...rivals],
  };
};

describe('trafficForecast', () => {
  it('flags the lapping Hypercar closing from behind on the live-rig multi-class capture', () => {
    const { approaching, ahead } = trafficForecast(multiClassTrafficState);
    expect(approaching.map((c) => c.id)).toEqual([4]); // the closing Hypercar
    expect(ahead).toHaveLength(0); // leader too far up the road; GTE is alongside (gap 0), spotter's job
  });

  it('flags a slower car ahead you are catching, and sorts each list nearest-ETA first', () => {
    const { approaching, ahead } = trafficForecast(
      buildFrame({
        rivals: [
          { id: 1, gapToPlayerS: -2.5, gapToPlayerM: -20, closingRateMps: 5, className: 'GTE' }, // ahead, catching
          { id: 2, gapToPlayerS: -1.2, gapToPlayerM: -8, closingRateMps: 5, className: 'GTE' }, // closer ahead
        ],
      }),
    );
    expect(approaching).toHaveLength(0);
    expect(ahead.map((c) => c.id)).toEqual([2, 1]); // ETA 1.6 before 4.0
  });

  it('ignores a non-converging car and a car beyond the horizon', () => {
    const { approaching } = trafficForecast(
      buildFrame({
        rivals: [
          { id: 1, gapToPlayerS: 2.0, gapToPlayerM: 60, closingRateMps: 1 }, // closing too slowly
          { id: 2, gapToPlayerS: 9.0, gapToPlayerM: 200, closingRateMps: 10 }, // beyond 5 s horizon
        ],
      }),
    );
    expect(approaching).toHaveLength(0);
  });

  it('suppresses a same-class battle by default, but reports it when differentClassOnly is off', () => {
    const frame = buildFrame({
      rivals: [
        { id: 1, gapToPlayerS: 1.5, gapToPlayerM: 40, closingRateMps: 8, className: 'LMP2' },
      ],
    });
    expect(trafficForecast(frame).approaching).toHaveLength(0); // same class as the player
    expect(
      trafficForecast(frame, { differentClassOnly: false }).approaching.map((c) => c.id),
    ).toEqual([1]);
  });

  it('emits nothing while the player is in the pit lane', () => {
    const frame = buildFrame({
      playerInPit: true,
      rivals: [{ id: 1, gapToPlayerS: 1.0, gapToPlayerM: 20, closingRateMps: 10 }],
    });
    expect(trafficForecast(frame).approaching).toHaveLength(0);
  });
});

describe('trafficRule via EventDetector', () => {
  it('raises one Tier-1 faster_class_approaching for the nearest closer, with ETA in the payload', () => {
    const detector = new EventDetector([trafficRule()]);
    const events = detector.process(multiClassTrafficState);
    const fca = events.filter((e) => e.type === 'faster_class_approaching');
    expect(fca).toHaveLength(1);
    expect(fca[0]?.tier).toBe(1);
    expect(fca[0]?.payload.carId).toBe(4);
    expect(fca[0]?.payload.className).toBe('Hypercar');
    expect(fca[0]?.payload.etaS).toBeCloseTo(25 / 12.5, 6); // 2.0 s (gapM / closingRate)
    expect(fca[0]?.payload.count).toBe(1);
    expect(fca[0]?.dedupeKey).toBe('faster_class_approaching:4');
  });

  it('raises slower_class_ahead for a slower car ahead', () => {
    const detector = new EventDetector([trafficRule()]);
    const events = detector.process(
      buildFrame({
        rivals: [
          { id: 7, gapToPlayerS: -2.0, gapToPlayerM: -20, closingRateMps: 5, className: 'GTE' },
        ],
      }),
    );
    const sca = events.filter((e) => e.type === 'slower_class_ahead');
    expect(sca).toHaveLength(1);
    expect(sca[0]?.tier).toBe(1);
    expect(sca[0]?.payload.carId).toBe(7);
    expect(sca[0]?.dedupeKey).toBe('slower_class_ahead:7');
  });

  it('announces the same approaching car only once within the cooldown window', () => {
    const detector = new EventDetector([trafficRule()]);
    const emitted: EngineerEvent[] = [];
    for (let i = 0; i < 3; i += 1) {
      emitted.push(
        ...detector.process({
          ...multiClassTrafficState,
          tick: 64980 + i,
          monotonicMs: 1083000 + i * 200, // well within the 8 s cooldown
        }),
      );
    }
    expect(emitted.filter((e) => e.type === 'faster_class_approaching')).toHaveLength(1);
  });
});
