import { z } from 'zod';
import { unit01 } from './primitives';

/**
 * Derived strategy types (docs/04 §Derived / strategy types). The *math* that produces
 * these lives in `@race-engineer/strategy` (docs/05) — `core` only owns their shape so the
 * LLM and UI can consume validated, deterministic numbers. The LLM never computes them.
 */

export const FuelPlanSchema = z.object({
  perLapLiters: z.number().nonnegative(),
  lapsRemainingOnFuel: z.number().nonnegative(),
  lapsToFinish: z.number().nonnegative().nullable(),
  litersToFinish: z.number().nonnegative().nullable(),
  litersToAddNextStop: z.number().nonnegative().nullable(),
  fuelSaveTargetLitersPerLap: z.number().nonnegative().nullable(), // to stretch a stint
  confidence01: unit01, // shrinks with low sample size
});
export type FuelPlan = z.infer<typeof FuelPlanSchema>;

export const StintPlanSchema = z.object({
  stints: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      startLap: z.number().int().nonnegative(),
      endLap: z.number().int().nonnegative(),
      fuelAddLiters: z.number().nonnegative(),
      tireCompound: z.string().nullable(),
      expectedDegradation01: unit01,
    }),
  ),
  pitWindows: z.array(
    z.object({
      earliestLap: z.number().int().nonnegative(),
      latestLap: z.number().int().nonnegative(),
      reason: z.string(),
    }),
  ),
  mandatoryStopsRemaining: z.number().int().nonnegative().nullable(),
});
export type StintPlan = z.infer<typeof StintPlanSchema>;
