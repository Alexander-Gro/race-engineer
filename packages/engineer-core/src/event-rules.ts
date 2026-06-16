import {
  energyLowRule,
  fcyRule,
  fuelLowRule,
  lapCompletedRule,
  spotterRule,
  strategyCalloutRule,
  tireTempRule,
  trafficRule,
  type EventRule,
} from '@race-engineer/core';

/**
 * The default Event Detector rule set the Core runs over the `RaceState` stream (build-plan
 * §"always-on" / docs/04 §Events). Pure detection rules only — they emit advisory `EngineerEvent`s;
 * nothing here writes to the game. Audio/voice routing of these events is the radio layer (T5.4),
 * not the Core. Override via `EngineerCoreOptions.eventRules` (e.g. to tune thresholds per session).
 *
 * Spotter first (Tier-0 reflex), then traffic / FCY / fuel / Virtual Energy (Tier-1), the strategy pit-window
 * call-outs (T7.9 — reads the always-on stint plan via the detection context), then `lap_completed`
 * (the lap marker other layers — strategy, persistence — key off).
 */
export const defaultEventRules = (): EventRule[] => [
  spotterRule(),
  trafficRule(),
  fcyRule(),
  fuelLowRule(),
  energyLowRule(),
  tireTempRule(),
  strategyCalloutRule(),
  lapCompletedRule(),
];
