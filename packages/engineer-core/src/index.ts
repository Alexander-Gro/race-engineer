// @race-engineer/engineer-core
// The headless Engineer Core (build-plan T6.1): drives the tick pipeline (Adapter → Normalizer
// → canonical RaceState) in a worker / utility process and pushes throttled snapshots (~10–15 Hz)
// to the renderer over a typed IPC contract. Provider/source-agnostic and fully testable offline
// against the sim-replay/synthetic source — no Electron, no game. Read-only/advisory throughout.
export { EngineerCore } from './core';
export type { EngineerCoreOptions } from './core';
export { Throttle, intervalForHz } from './throttle';
export { StrategyEngine } from './strategy';
export { defaultEventRules } from './event-rules';
export { SNAPSHOT_CHANNEL } from './ipc';
export type { EngineerSnapshot, EngineerBridge, SnapshotTransport, StrategySummary } from './ipc';
