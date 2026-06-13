import { EngineerEventSchema, FuelPlanSchema, RaceStateSchema, StintPlanSchema } from './schema';
import type { EngineerEvent, FuelPlan, RaceState, StintPlan } from './schema';

/**
 * Runtime validators for the canonical schema. `parse*` throws on invalid input,
 * `safeParse*` returns a discriminated result, and `is*` is a boolean type guard. Adapters
 * and IPC boundaries should validate untrusted frames before they enter the pipeline.
 */

// --- RaceState ---
export const parseRaceState = (data: unknown): RaceState => RaceStateSchema.parse(data);
export const safeParseRaceState = (data: unknown) => RaceStateSchema.safeParse(data);
export const isRaceState = (data: unknown): data is RaceState =>
  RaceStateSchema.safeParse(data).success;

// --- EngineerEvent ---
export const parseEngineerEvent = (data: unknown): EngineerEvent => EngineerEventSchema.parse(data);
export const safeParseEngineerEvent = (data: unknown) => EngineerEventSchema.safeParse(data);
export const isEngineerEvent = (data: unknown): data is EngineerEvent =>
  EngineerEventSchema.safeParse(data).success;

// --- FuelPlan ---
export const parseFuelPlan = (data: unknown): FuelPlan => FuelPlanSchema.parse(data);
export const safeParseFuelPlan = (data: unknown) => FuelPlanSchema.safeParse(data);
export const isFuelPlan = (data: unknown): data is FuelPlan =>
  FuelPlanSchema.safeParse(data).success;

// --- StintPlan ---
export const parseStintPlan = (data: unknown): StintPlan => StintPlanSchema.parse(data);
export const safeParseStintPlan = (data: unknown) => StintPlanSchema.safeParse(data);
export const isStintPlan = (data: unknown): data is StintPlan =>
  StintPlanSchema.safeParse(data).success;
