// @race-engineer/radio
// The reactive radio loop (docs/06 §Reactive, docs/07 §PTT flow): wires push-to-talk →
// STT → AI(read-only tools) → streaming TTS from the M4/M5 pieces. Provider-agnostic and
// fully testable offline with a scripted provider + fakes (no key, no mic, no game). The
// live push-to-talk half (real mic/STT/TTS + a mapped wheel button) is human-assisted on
// the Windows rig. Read-only/advisory throughout — no path from here to the game.
export { ReactiveRadioLoop } from './loop';
export type { ReactiveRadioLoopOptions, ReactiveRadioLoopEvents } from './loop';
export { LATENCY_BUDGET_MS, LatencyAggregator, withinBudget } from './latency';
export type { TurnLatency, LatencySummary } from './latency';
export {
  ProactiveVoiceRouter,
  templatePhraser,
  llmPhraser,
  defaultVoicePriority,
  PROACTIVE_SYSTEM_PROMPT,
} from './proactive';
export type {
  ProactivePhraser,
  ProactiveVoiceRouterOptions,
  RoutedOutcome,
  LlmPhraserOptions,
} from './proactive';
export { isQuietWindow, shouldAnnounce } from './proactivity';
export type {
  ProactivityLevel,
  DriverLoadInputs,
  QuietWindowOptions,
  AnnounceContext,
} from './proactivity';
