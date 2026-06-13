import type { WheelArray } from '../schema';

/**
 * Unit and wheel-order conversions used by the Normalizer to turn raw, game-specific frames
 * into the canonical schema (docs/04 §Conventions). Canonical units are SI-ish: speeds m/s,
 * pressures kPa, temperatures °C; wheel order is always [FL, FR, RL, RR]. These are pure
 * helpers — the real LMU normalizer (T2.3) composes them; sim-replay frames are already
 * canonical and need none.
 */

export const kphToMps = (kph: number): number => (kph * 1000) / 3600;
export const mpsToKph = (mps: number): number => (mps * 3600) / 1000;

const PSI_PER_KPA = 6.894757293168361;
export const psiToKpa = (psi: number): number => psi * PSI_PER_KPA;
export const kpaToPsi = (kpa: number): number => kpa / PSI_PER_KPA;
export const barToKpa = (bar: number): number => bar * 100;

export const kelvinToCelsius = (kelvin: number): number => kelvin - 273.15;

/** Normalize a raw wear reading to the canonical 0..1 scale (0 = worn out, 1 = new). */
export const normalizeWear01 = (raw: number, fullValue: number): number => {
  if (fullValue <= 0) return 0;
  return Math.min(1, Math.max(0, raw / fullValue));
};

export type WheelPosition = 'FL' | 'FR' | 'RL' | 'RR';

/** Canonical wheel order. Every `WheelArray<T>` is indexed in this order. */
export const CANONICAL_WHEEL_ORDER: readonly WheelPosition[] = ['FL', 'FR', 'RL', 'RR'];

/**
 * Reorder a game's native wheel array into canonical [FL, FR, RL, RR] order.
 * `sourceOrder` declares which wheel each index of `values` represents.
 */
export const reorderWheels = <T>(
  values: readonly T[],
  sourceOrder: readonly WheelPosition[],
): WheelArray<T> => {
  const pick = (position: WheelPosition): T => {
    const index = sourceOrder.indexOf(position);
    const value = index >= 0 ? values[index] : undefined;
    if (value === undefined) throw new Error(`reorderWheels: missing wheel ${position}`);
    return value;
  };
  return [pick('FL'), pick('FR'), pick('RL'), pick('RR')];
};
