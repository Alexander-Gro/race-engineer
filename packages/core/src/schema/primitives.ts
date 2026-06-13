import { z } from 'zod';

/**
 * Shared schema primitives for the canonical data model (docs/04).
 *
 * Unit conventions (normalized once, here in `core`):
 *  - temperatures °C, pressures kPa, fuel liters, distances meters, speeds m/s,
 *    times seconds (floats), angles radians.
 *  - Wheel order is always [FL, FR, RL, RR].
 */

/** A wheel-indexed 4-tuple in [FL, FR, RL, RR] order. */
export const wheelArray = <T extends z.ZodTypeAny>(item: T) => z.tuple([item, item, item, item]);

/** Type helper mirroring {@link wheelArray}: `[T, T, T, T]`. */
export type WheelArray<T> = [T, T, T, T];

/** A value constrained to the inclusive [0, 1] range — the `*01` field convention. */
export const unit01 = z.number().min(0).max(1);

/** Latency / delivery tier for events and voice routing (see docs/01 §Latency tiers). */
export const tierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type Tier = z.infer<typeof tierSchema>;
