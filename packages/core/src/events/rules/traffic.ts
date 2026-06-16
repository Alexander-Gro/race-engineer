import type { CarState, PlayerCar, RaceState, Tier } from '../../schema';
import type { CandidateEvent, EventRule } from '../types';

/**
 * Multi-class traffic forecasting (docs/05 §6) — the LMU differentiator. From `closingRateMps` and
 * `gapToPlayerS` it predicts encounters *before* they happen and emits Tier-1 templated warnings:
 *
 *  - `faster_class_approaching` — a car **behind** is closing fast (a Hypercar about to lap an LMP2):
 *    "Hypercar closing, 3 seconds, leave room into the Esses." docs/05 §6.
 *  - `slower_class_ahead` — a car **ahead** you are catching, especially into braking zones:
 *    "GT3 ahead in sector 2, 1.5 slower." docs/05 §6.
 *
 * The `clear`/`car_left`/`car_right` spotter (T3.4) handles cars *already alongside* (a positional
 * fact); this rule is the *predictive* half its comment defers to — closing speed, not geometry.
 *
 * Signals (canonical, Normalizer-supplied — docs/04):
 *  - `gapToPlayerS` — signed time gap: **+ = behind the player, − = ahead** (docs/04).
 *  - `closingRateMps` — convergence speed. Convention assumed here: **positive = the gap is closing**
 *    (matches the live-rig multi-class capture: the lapping Hypercar reads +12.5). Confirm the sign
 *    against live data alongside the spotter's `lateralPos` sign (docs/03) before trusting it.
 *
 * Pure and allocation-light (runs every tick); level-triggered like `fuel_low`, with the
 * {@link EventDetector}'s cooldown keeping it to one call-out per car per window.
 *
 * **"Faster/slower" is read from the actual class *pace*, not geometry** (fixed after a live GT3 capture
 * wrongly heard "slower class ahead" — a GT3 has no slower class). Each class's pace is its fastest known
 * lap (`bestLapS ?? lastLapS`) in the current field; a car only raises `faster_class_approaching` if its
 * class is genuinely faster than the player's, and `slower_class_ahead` only if genuinely slower. When a
 * class's pace isn't known yet (no lap set), we stay silent rather than guess (docs/05 §8 trustworthy-or-
 * silent). `differentClassOnly:false` opts back into the old geometry-only behaviour (single-class use).
 */

export interface TrafficOptions {
  /** Max time-gap behind (s) for a closing car to raise `faster_class_approaching`. Default 5. */
  horizonBehindS?: number;
  /** Max time-gap ahead (s) for a car you're catching to raise `slower_class_ahead`. Default 4. */
  horizonAheadS?: number;
  /** Min convergence speed (m/s) to count as a real approach (filters noise). Default 3. */
  minClosingMps?: number;
  /** When both classes are known, only warn about a *different* class (multi-class focus). Default true. */
  differentClassOnly?: boolean;
  /** Delivery tier for the emitted events. Default 1 (templated). */
  tier?: Tier;
  priorities?: { approaching?: number; ahead?: number };
  cooldownMs?: { approaching?: number; ahead?: number };
}

interface ResolvedOptions {
  horizonBehindS: number;
  horizonAheadS: number;
  minClosingMps: number;
  differentClassOnly: boolean;
  tier: Tier;
  priorities: { approaching: number; ahead: number };
  cooldownMs: { approaching: number; ahead: number };
}

const resolve = (o: TrafficOptions): ResolvedOptions => ({
  horizonBehindS: o.horizonBehindS ?? 5,
  horizonAheadS: o.horizonAheadS ?? 4,
  minClosingMps: o.minClosingMps ?? 3,
  differentClassOnly: o.differentClassOnly ?? true,
  tier: o.tier ?? 1,
  priorities: { approaching: o.priorities?.approaching ?? 70, ahead: o.priorities?.ahead ?? 55 },
  cooldownMs: {
    approaching: o.cooldownMs?.approaching ?? 8000,
    ahead: o.cooldownMs?.ahead ?? 10000,
  },
});

const eligible = (player: PlayerCar, car: CarState): boolean =>
  !car.isPlayer && car.id !== player.id && !car.pit.inPitLane;

/**
 * Representative pace (s/lap) per class for the current field — the **fastest** known lap
 * (`bestLapS`, falling back to `lastLapS`) across that class's cars. Lower = faster class. Pure,
 * recomputed per tick; a class with no completed lap yet is simply absent (→ unknown relation).
 */
export const classPaceS = (state: RaceState): Map<string, number> => {
  const pace = new Map<string, number>();
  const consider = (cls: string | null, lap: number | null): void => {
    if (cls === null || lap === null || !(lap > 0)) return;
    const cur = pace.get(cls);
    if (cur === undefined || lap < cur) pace.set(cls, lap);
  };
  for (const c of state.cars) {
    consider(c.className, c.bestLapS);
    consider(c.className, c.lastLapS);
  }
  consider(state.player.className, state.player.bestLapS);
  consider(state.player.className, state.player.lastLapS);
  return pace;
};

type ClassRelation = 'faster' | 'slower' | 'same' | 'unknown';

/** The other car's class speed relative to the player's, by field pace. Same class (or equal pace) ⇒ `same`. */
const classRelation = (
  player: PlayerCar,
  car: CarState,
  pace: Map<string, number>,
): ClassRelation => {
  if (player.className !== null && car.className !== null && player.className === car.className) {
    return 'same';
  }
  const p = player.className === null ? undefined : pace.get(player.className);
  const o = car.className === null ? undefined : pace.get(car.className);
  if (p === undefined || o === undefined) return 'unknown';
  if (o < p) return 'faster';
  if (o > p) return 'slower';
  return 'same'; // distinct classes, equal pace ⇒ treat as the same tier (no faster/slower call)
};

/** Seconds until the cars meet: distance gap / closing speed, falling back to the time gap. */
const etaS = (car: CarState): number => {
  if (car.gapToPlayerM !== null && car.closingRateMps !== null && car.closingRateMps > 0) {
    return Math.abs(car.gapToPlayerM) / car.closingRateMps;
  }
  return Math.abs(car.gapToPlayerS ?? Infinity);
};

export interface TrafficForecast {
  /** Faster cars closing from behind, nearest (smallest ETA) first. */
  approaching: CarState[];
  /** Slower cars ahead you are catching, nearest first. */
  ahead: CarState[];
}

/**
 * Classify the field into faster-approaching-from-behind and slower-ahead-you're-catching. Pure;
 * exported so the UI and tests reuse the exact predicate the rule fires on (mirrors `spotterContacts`).
 */
export const trafficForecast = (
  state: RaceState,
  options: TrafficOptions = {},
): TrafficForecast => {
  const o = resolve(options);
  const approaching: CarState[] = [];
  const ahead: CarState[] = [];
  if (state.player.pit.inPitLane) return { approaching, ahead };

  const pace = classPaceS(state);
  for (const car of state.cars) {
    if (!eligible(state.player, car)) continue;
    if (car.gapToPlayerS === null || car.closingRateMps === null) continue;
    if (car.closingRateMps < o.minClosingMps) continue; // not converging

    const behind = car.gapToPlayerS > 0 && car.gapToPlayerS <= o.horizonBehindS;
    const aheadOfPlayer = car.gapToPlayerS < 0 && -car.gapToPlayerS <= o.horizonAheadS;
    if (!behind && !aheadOfPlayer) continue;

    if (o.differentClassOnly) {
      // Class-rank gated (the multi-class default): a car raises "faster approaching" only if its class
      // is genuinely faster, "slower ahead" only if genuinely slower. Same/unknown class ⇒ stay silent.
      const rel = classRelation(state.player, car, pace);
      if (behind && rel === 'faster') approaching.push(car);
      else if (aheadOfPlayer && rel === 'slower') ahead.push(car);
    } else {
      // Geometry-only opt-out (single-class / "warn me about everyone"): position + closing, any class.
      if (behind) approaching.push(car);
      else ahead.push(car);
    }
  }
  approaching.sort((a, b) => etaS(a) - etaS(b));
  ahead.sort((a, b) => etaS(a) - etaS(b));
  return { approaching, ahead };
};

const trafficEvent = (
  type: 'faster_class_approaching' | 'slower_class_ahead',
  car: CarState,
  count: number,
  priority: number,
  tier: Tier,
  cooldownMs: number,
): CandidateEvent => ({
  type,
  tier,
  priority,
  payload: {
    carId: car.id,
    driverName: car.driverName,
    className: car.className,
    gapToPlayerS: car.gapToPlayerS,
    closingRateMps: car.closingRateMps,
    etaS: etaS(car),
    count,
  },
  // One call-out per car per cooldown window (a new closer car re-announces; the same one is held off).
  dedupeKey: `${type}:${car.id}`,
  cooldownMs,
});

/**
 * Build the traffic-forecasting rule. Plugs into {@link EventDetector} like the other rules. Emits at
 * most one event per category per tick — the most *imminent* (smallest ETA) car — with `count` of how
 * many qualify, so a pack reads as one warning rather than a burst.
 */
export const trafficRule = (options: TrafficOptions = {}): EventRule => {
  const o = resolve(options);
  return {
    name: 'traffic',
    detect({ curr }) {
      const { approaching, ahead } = trafficForecast(curr, options);
      const events: CandidateEvent[] = [];
      if (approaching.length > 0) {
        events.push(
          trafficEvent(
            'faster_class_approaching',
            approaching[0]!,
            approaching.length,
            o.priorities.approaching,
            o.tier,
            o.cooldownMs.approaching,
          ),
        );
      }
      if (ahead.length > 0) {
        events.push(
          trafficEvent(
            'slower_class_ahead',
            ahead[0]!,
            ahead.length,
            o.priorities.ahead,
            o.tier,
            o.cooldownMs.ahead,
          ),
        );
      }
      return events;
    },
  };
};
