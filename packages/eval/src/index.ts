// @race-engineer/eval
// Eval suites (accuracy + latency) for CI on recorded / synthetic telemetry (build-plan T10.4,
// docs/06 §Evaluation, docs/10 acceptance gates). Pure, deterministic, read-only: each eval runs
// the *same* always-on strategy/event/voice machinery the app runs over a `RaceState` stream (or
// scripted radio turns) and scores it against ground truth derived from the data itself. The math
// lives in `@race-engineer/strategy`/`core` — these evals only measure, never invent (CLAUDE.md
// rule 1). Drive them from the `pnpm eval` CLI or from CI tests.
export { evalFuelAccuracy } from './fuel-accuracy';
export type { FuelAccuracyResult, FuelAccuracySample, FuelAccuracyOptions } from './fuel-accuracy';

export { evalEventCorrectness } from './events';
export type { EventCorrectnessResult } from './events';

export { summarizeTurnLatencies, LATENCY_BUDGET_MS, withinBudget } from './latency';
export type { LatencySummary, TurnLatency } from './latency';
