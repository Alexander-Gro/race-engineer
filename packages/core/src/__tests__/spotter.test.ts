import { describe, expect, it } from 'vitest';
import { EventDetector, spotterContacts, spotterRule } from '../events';
import type { EngineerEvent, RaceState } from '../schema';
import { makeCarState, makePlayerCar, multiClassTrafficState, raceStartState } from '../fixtures';

interface RivalSpec {
  id: number;
  lateralPos: number | null;
  gapToPlayerM: number | null;
  inPitLane?: boolean;
}

/** Build a frame with a player on the racing line and the given rivals around it. */
const buildFrame = (opts: {
  tick?: number;
  monotonicMs?: number;
  playerLateral?: number | null;
  playerInPit?: boolean;
  rivals: RivalSpec[];
}): RaceState => {
  const player = makePlayerCar({
    id: 99,
    position: 5,
    lateralPos: opts.playerLateral === undefined ? 0 : opts.playerLateral,
    pit: { inPitLane: opts.playerInPit ?? false, inPitStall: false, stops: 0, state: 'none' },
  });
  const rivals = opts.rivals.map((r, i) =>
    makeCarState({
      id: r.id,
      position: 6 + i,
      className: 'LMP2',
      driverName: `R${r.id}`,
      lateralPos: r.lateralPos,
      gapToPlayerM: r.gapToPlayerM,
      pit: { inPitLane: r.inPitLane ?? false, inPitStall: false, stops: 0, state: 'none' },
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

describe('spotterRule — alongside detection', () => {
  it('announces a car drawing alongside on the right exactly once, then clear when it passes', () => {
    const detector = new EventDetector([spotterRule()]);
    const emitted: EngineerEvent[] = [];
    // Rival 7 (lateralPos +2.0 ⇒ right) closes from behind, runs alongside, then clears ahead.
    const arc = [
      { gap: 30, ms: 0 }, // behind, not alongside
      { gap: 8, ms: 200 }, // still beyond the overlap window
      { gap: 3, ms: 400 }, // alongside → car_right
      { gap: 1, ms: 600 }, // alongside (same car) → suppressed by cooldown
      { gap: -2, ms: 800 }, // alongside, now ahead → suppressed
      { gap: -8, ms: 1000 }, // cleared ahead → clear
    ];
    arc.forEach(({ gap, ms }, i) => {
      emitted.push(
        ...detector.process(
          buildFrame({
            tick: i,
            monotonicMs: ms,
            rivals: [{ id: 7, lateralPos: 2.0, gapToPlayerM: gap }],
          }),
        ),
      );
    });

    const rights = emitted.filter((e) => e.type === 'car_right');
    expect(rights).toHaveLength(1);
    expect(emitted.filter((e) => e.type === 'car_left')).toHaveLength(0);
    expect(rights[0]?.tier).toBe(0);
    expect(rights[0]?.payload.carId).toBe(7);
    expect(rights[0]?.dedupeKey).toBe('car_right:7');

    const clears = emitted.filter((e) => e.type === 'clear');
    expect(clears).toHaveLength(1);
    expect(clears[0]?.payload.sides).toEqual(['right']);
    expect(clears[0]?.tier).toBe(0);
  });

  it('emits three_wide when flanked on both sides, suppressing the individual side calls', () => {
    const detector = new EventDetector([spotterRule()]);
    const events = detector.process(
      buildFrame({
        rivals: [
          { id: 7, lateralPos: 2.0, gapToPlayerM: 0 }, // right
          { id: 8, lateralPos: -2.0, gapToPlayerM: 0 }, // left
        ],
      }),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain('three_wide');
    expect(types).not.toContain('car_left');
    expect(types).not.toContain('car_right');
    const tw = events.find((e) => e.type === 'three_wide');
    expect(tw?.tier).toBe(0);
    expect(tw?.priority).toBe(100);
    expect(tw?.payload).toMatchObject({ leftCarId: 8, rightCarId: 7 });
  });

  it('stays silent for a car that is close laterally but not longitudinally overlapping', () => {
    const detector = new EventDetector([spotterRule()]);
    expect(
      detector.process(buildFrame({ rivals: [{ id: 7, lateralPos: 2.0, gapToPlayerM: 20 }] })),
    ).toHaveLength(0);
  });

  it('treats a car with no real lateral separation as in-line (no side call)', () => {
    const detector = new EventDetector([spotterRule()]);
    expect(
      detector.process(buildFrame({ rivals: [{ id: 7, lateralPos: 0.1, gapToPlayerM: 0 }] })),
    ).toHaveLength(0); // 0.1 m < 0.5 m deadband
  });

  it('ignores a car on the far side of a wide track (beyond maxLateral)', () => {
    const detector = new EventDetector([spotterRule()]);
    expect(
      detector.process(buildFrame({ rivals: [{ id: 7, lateralPos: 12, gapToPlayerM: 0 }] })),
    ).toHaveLength(0); // 12 m > 10 m cap
  });

  it('cannot resolve a side without lateralPos and stays silent', () => {
    const detector = new EventDetector([spotterRule()]);
    expect(
      detector.process(buildFrame({ rivals: [{ id: 7, lateralPos: null, gapToPlayerM: 0 }] })),
    ).toHaveLength(0);
  });

  it('excludes cars in the pit lane and goes silent when the player is in the pits', () => {
    const detector = new EventDetector([spotterRule()]);
    expect(
      detector.process(
        buildFrame({ rivals: [{ id: 7, lateralPos: 2.0, gapToPlayerM: 0, inPitLane: true }] }),
      ),
    ).toHaveLength(0);
    detector.reset();
    expect(
      detector.process(
        buildFrame({ playerInPit: true, rivals: [{ id: 7, lateralPos: 2.0, gapToPlayerM: 0 }] }),
      ),
    ).toHaveLength(0);
  });

  it('re-announces when a different car draws alongside (dedupe is per car)', () => {
    const detector = new EventDetector([spotterRule()]);
    const emitted: EngineerEvent[] = [];
    // Car 7 alongside right, then gone; car 9 draws alongside right shortly after.
    emitted.push(
      ...detector.process(
        buildFrame({
          tick: 0,
          monotonicMs: 0,
          rivals: [{ id: 7, lateralPos: 2, gapToPlayerM: 0 }],
        }),
      ),
    );
    emitted.push(
      ...detector.process(
        buildFrame({
          tick: 1,
          monotonicMs: 200,
          rivals: [{ id: 7, lateralPos: 2, gapToPlayerM: -8 }],
        }),
      ),
    );
    emitted.push(
      ...detector.process(
        buildFrame({
          tick: 2,
          monotonicMs: 400,
          rivals: [{ id: 9, lateralPos: 2, gapToPlayerM: 0 }],
        }),
      ),
    );
    const rights = emitted.filter((e) => e.type === 'car_right');
    expect(rights).toHaveLength(2);
    expect(rights.map((e) => e.payload.carId)).toEqual([7, 9]);
    expect(emitted.filter((e) => e.type === 'clear')).toHaveLength(1); // car 7 passing
  });

  it('honors rightIsPositive=false (flips the lateral sign convention)', () => {
    const detector = new EventDetector([spotterRule({ rightIsPositive: false })]);
    const events = detector.process(
      buildFrame({ rivals: [{ id: 7, lateralPos: 2.0, gapToPlayerM: 0 }] }),
    );
    expect(events.find((e) => e.type === 'car_left')).toBeDefined();
    expect(events.find((e) => e.type === 'car_right')).toBeUndefined();
  });
});

describe('spotterContacts — pure geometry on the multi-class fixture', () => {
  it('classifies the GTE as alongside-right and the lapping Hypercar as not yet alongside', () => {
    const contacts = spotterContacts(multiClassTrafficState);
    expect(contacts.right.map((c) => c.id)).toEqual([31]); // GTE running side-by-side
    expect(contacts.left).toEqual([]);
    // Hypercar #4 is closing from 25 m back — not alongside (a faster-class case, not T3.4).
    expect([...contacts.left, ...contacts.right].map((c) => c.id)).not.toContain(4);
  });

  it('fires a Tier-0 car_right for the alongside GTE', () => {
    const detector = new EventDetector([spotterRule()]);
    const events = detector.process(multiClassTrafficState);
    const right = events.find((e) => e.type === 'car_right');
    expect(right?.tier).toBe(0);
    expect(right?.payload.carId).toBe(31);
  });
});
