import { z } from 'zod';
import { tierSchema } from './primitives';

/** Discrete events emitted by the Event Detector (docs/04 §Events). */

export const EventTypeSchema = z.enum([
  // Tier 0 — reflex spotter (pre-rendered audio)
  'car_left',
  'car_right',
  'three_wide',
  'clear',
  // Tier 1 — templated
  'lap_completed',
  'fuel_low',
  'tire_temp_out_of_window',
  'pit_window_open',
  'box_this_lap',
  'blue_flag',
  'faster_class_approaching',
  'flag_changed',
  // Tier 2/3 — conversational / deliberative (LLM-phrased or driver-initiated)
  'strategy_update',
  'undercut_opportunity',
  'fcy_opportunity',
  'rival_pitted',
  'incident_ahead',
  'driver_question',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EngineerEventSchema = z.object({
  id: z.string(),
  tick: z.number().int().nonnegative(),
  type: EventTypeSchema,
  tier: tierSchema, // latency/delivery tier (see docs/01)
  priority: z.number(), // for the voice queue; higher preempts
  payload: z.record(z.string(), z.unknown()),
  dedupeKey: z.string().optional(), // suppress repeats (e.g. same car alongside)
  cooldownMs: z.number().nonnegative().optional(),
});
export type EngineerEvent = z.infer<typeof EngineerEventSchema>;
