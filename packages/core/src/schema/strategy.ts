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
  // --- Virtual Energy (LMU). The binding stint/finish constraint is whichever of fuel and VE
  //     runs out first, so `bindingConstraint` tells the consumer which figures to surface.
  //     All VE fields are null when the series doesn't expose VE — then the fuel figures above
  //     stand alone (fuel-only planning, e.g. non-LMU). Units mirror VE's 0..1 budget.
  perLapEnergy01: z.number().nonnegative().nullable(),
  lapsRemainingOnEnergy: z.number().nonnegative().nullable(),
  energyToFinish01: z.number().nonnegative().nullable(),
  energyToAddNextStop01: z.number().nonnegative().nullable(),
  energySaveTargetPerLap01: z.number().nonnegative().nullable(), // to stretch a stint on VE
  bindingConstraint: z.enum(['fuel', 'energy']).nullable(),
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
