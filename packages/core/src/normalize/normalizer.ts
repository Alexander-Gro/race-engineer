import type { RaceState } from '../schema';
import { RollingFuel } from './rolling-fuel';

/**
 * Converts an adapter's native frame into a canonical {@link RaceState} and computes simple
 * derived values (docs/01 §Normalizer). Stateful: it accumulates history across ticks (e.g.
 * rolling fuel-per-lap). One Normalizer instance per session.
 */
export interface Normalizer<TFrame> {
  toRaceState(frame: TFrame): RaceState;
}

/**
 * Skeleton Normalizer for already-canonical frames (the sim-replay source): it passes the
 * frame through and fills the Normalizer-owned derived fuel fields (rolling per-lap average
 * and laps-remaining) from observed consumption. The real LMU normalizer (T2.3) will also
 * map raw struct fields and units here. Inputs are never mutated.
 */
export const createCanonicalNormalizer = (windowLaps = 5): Normalizer<RaceState> => {
  const fuel = new RollingFuel(windowLaps);
  return {
    toRaceState(frame) {
      const { perLapAvgLiters, lapsRemainingEst } = fuel.update(
        frame.player.fuel.liters,
        frame.player.lapsCompleted,
      );
      return {
        ...frame,
        player: {
          ...frame.player,
          fuel: { ...frame.player.fuel, perLapAvgLiters, lapsRemainingEst },
        },
      };
    },
  };
};
