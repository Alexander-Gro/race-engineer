import type { CarState, PlayerCar, RaceState, Tier } from '../../schema';
import type { CandidateEvent, EventRule } from '../types';

/**
 * Spotter geometry → reflex proximity events (docs/04 §Events, docs/01 Tier 0). Detects a
 * rival drawing **alongside** the player and emits `car_left` / `car_right` / `three_wide`,
 * plus `clear` when the player is no longer flanked. These are Tier-0 reflex calls
 * (pre-rendered audio, never an LLM round-trip) and the highest-priority items in the voice
 * queue — they preempt chatter (docs/01 §Latency tiers). Audio routing itself is M4; this
 * task produces the events only.
 *
 * Pure and deterministic: "alongside" is recomputed from the canonical fields on both the
 * previous and current tick, so `clear` is an edge between flanked→not-flanked with no
 * hidden state (the {@link EventDetector} still owns cooldown/dedupe).
 *
 * Signals used (canonical, Normalizer-supplied — docs/04):
 *  - `gapToPlayerM` — along-track gap (+behind / −ahead); |gap| within a car length ⇒
 *    longitudinally overlapping ("alongside").
 *  - `lateralPos` — signed offset from the racing line; the *difference* vs the player tells
 *    which side. Convention assumed here: **positive = the driver's right** (flip
 *    `rightIsPositive` once T2.3 confirms LMU's sign against live data).
 *
 * `closingRateMps` is intentionally not used here — closing speed drives the *predictive*
 * `faster_class_approaching` call-out (docs/05 §6, scheduled for M7), whereas an alongside
 * car is a purely positional fact. `worldPos` needs the player's heading to resolve
 * left/right, which the schema doesn't expose, so `lateralPos` is the authoritative side cue.
 */

export type SpotterSide = 'left' | 'right';

export interface SpotterOptions {
  /** Max |along-track gap| (m) still counted as longitudinally overlapping. Default 5 (~a car length). */
  longitudinalOverlapM?: number;
  /** Min lateral separation (m) needed to assign a side; below this the car is treated as in-line. Default 0.5. */
  minLateralM?: number;
  /** Max lateral separation (m) still considered alongside (guards the far side of a wide track). Default 10. */
  maxLateralM?: number;
  /** When true, a rival with greater `lateralPos` than the player is on the RIGHT. Default true. */
  rightIsPositive?: boolean;
  /** Delivery tier for the emitted events. Default 0 (reflex). */
  tier?: Tier;
  priorities?: { side?: number; threeWide?: number; clear?: number };
  cooldownMs?: { side?: number; threeWide?: number; clear?: number };
}

interface ResolvedOptions {
  longitudinalOverlapM: number;
  minLateralM: number;
  maxLateralM: number;
  rightIsPositive: boolean;
  tier: Tier;
  priorities: { side: number; threeWide: number; clear: number };
  cooldownMs: { side: number; threeWide: number; clear: number };
}

const resolve = (o: SpotterOptions): ResolvedOptions => ({
  longitudinalOverlapM: o.longitudinalOverlapM ?? 5,
  minLateralM: o.minLateralM ?? 0.5,
  maxLateralM: o.maxLateralM ?? 10,
  rightIsPositive: o.rightIsPositive ?? true,
  tier: o.tier ?? 0,
  priorities: {
    side: o.priorities?.side ?? 90,
    threeWide: o.priorities?.threeWide ?? 100,
    clear: o.priorities?.clear ?? 50,
  },
  cooldownMs: {
    side: o.cooldownMs?.side ?? 3000,
    threeWide: o.cooldownMs?.threeWide ?? 3000,
    clear: o.cooldownMs?.clear ?? 2000,
  },
});

/** A rival is a spotter candidate only if it isn't us and isn't tucked away in the pit lane. */
const eligible = (player: PlayerCar, car: CarState): boolean =>
  !car.isPlayer && car.id !== player.id && !car.pit.inPitLane;

/** Which side a rival is on, or null when it isn't alongside / the side can't be resolved. */
const sideOf = (player: PlayerCar, car: CarState, o: ResolvedOptions): SpotterSide | null => {
  if (player.lateralPos === null || car.lateralPos === null) return null;
  if (car.gapToPlayerM === null) return null;
  if (Math.abs(car.gapToPlayerM) > o.longitudinalOverlapM) return null; // not overlapping
  const dLat = car.lateralPos - player.lateralPos;
  const sep = Math.abs(dLat);
  if (sep < o.minLateralM || sep > o.maxLateralM) return null; // in-line, or too far apart
  const isRight = o.rightIsPositive ? dLat > 0 : dLat < 0;
  return isRight ? 'right' : 'left';
};

/** Rivals currently alongside the player, split by side and sorted nearest-first. */
export interface SpotterContacts {
  left: CarState[];
  right: CarState[];
}

const byProximity = (a: CarState, b: CarState): number =>
  Math.abs(a.gapToPlayerM ?? Infinity) - Math.abs(b.gapToPlayerM ?? Infinity);

/**
 * Classify every rival as alongside-left / alongside-right / not-alongside. Pure; exported so
 * the UI and tests can reuse the exact geometry the spotter rule fires on.
 */
export const spotterContacts = (
  state: RaceState,
  options: SpotterOptions = {},
): SpotterContacts => {
  const o = resolve(options);
  const left: CarState[] = [];
  const right: CarState[] = [];
  // No spotter calls while we're in the pit lane.
  if (state.player.pit.inPitLane) return { left, right };
  for (const car of state.cars) {
    if (!eligible(state.player, car)) continue;
    const side = sideOf(state.player, car, o);
    if (side === 'left') left.push(car);
    else if (side === 'right') right.push(car);
  }
  left.sort(byProximity);
  right.sort(byProximity);
  return { left, right };
};

const sideEvent = (
  type: 'car_left' | 'car_right',
  cars: CarState[],
  o: ResolvedOptions,
): CandidateEvent => {
  const nearest = cars[0]!; // caller guarantees non-empty
  return {
    type,
    tier: o.tier,
    priority: o.priorities.side,
    payload: {
      carId: nearest.id,
      driverName: nearest.driverName,
      className: nearest.className,
      gapToPlayerM: nearest.gapToPlayerM,
      count: cars.length,
    },
    // Per adjacent car (docs/04): a new car drawing alongside re-announces; the same car
    // alongside is held off by the cooldown ("once per pass").
    dedupeKey: `${type}:${nearest.id}`,
    cooldownMs: o.cooldownMs.side,
  };
};

/**
 * Build the spotter detection rule. Plugs into {@link EventDetector} like the other rules.
 * `three_wide` subsumes the individual side calls (a real spotter shouts "three wide", not
 * "car left, car right"); `clear` fires on the flanked→clear transition.
 */
export const spotterRule = (options: SpotterOptions = {}): EventRule => {
  const o = resolve(options);
  return {
    name: 'spotter',
    detect({ prev, curr }) {
      const now = spotterContacts(curr, options);
      const before = prev ? spotterContacts(prev, options) : { left: [], right: [] };
      const events: CandidateEvent[] = [];

      const nowFlanked = now.left.length > 0 || now.right.length > 0;
      const beforeFlanked = before.left.length > 0 || before.right.length > 0;

      if (now.left.length > 0 && now.right.length > 0) {
        const l = now.left[0]!;
        const r = now.right[0]!;
        events.push({
          type: 'three_wide',
          tier: o.tier,
          priority: o.priorities.threeWide,
          payload: { leftCarId: l.id, rightCarId: r.id },
          dedupeKey: `three_wide:${l.id}:${r.id}`,
          cooldownMs: o.cooldownMs.threeWide,
        });
      } else {
        if (now.left.length > 0) events.push(sideEvent('car_left', now.left, o));
        if (now.right.length > 0) events.push(sideEvent('car_right', now.right, o));
      }

      if (beforeFlanked && !nowFlanked) {
        const sides: SpotterSide[] = [];
        if (before.left.length > 0) sides.push('left');
        if (before.right.length > 0) sides.push('right');
        events.push({
          type: 'clear',
          tier: o.tier,
          priority: o.priorities.clear,
          payload: { sides },
          dedupeKey: 'clear',
          cooldownMs: o.cooldownMs.clear,
        });
      }

      return events;
    },
  };
};
