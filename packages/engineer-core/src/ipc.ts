import type { EngineerEvent, FuelPlan, RaceState } from '@race-engineer/core';

/**
 * Typed IPC contract between the Engineer Core (worker / utility process) and the renderer
 * (docs/01 §Data flow, build-plan T6.1). The Core runs the hot tick pipeline **off the UI
 * thread** and pushes **throttled** snapshots (~10–15 Hz) to the renderer, which is a pure
 * consumer. A single envelope type keeps the wire contract stable as it grows (a strategy
 * summary, events, transcript can be added as optional fields without breaking callers).
 *
 * Read-only/advisory by construction: snapshots flow Core → renderer only. There is no
 * renderer→game channel anywhere in this contract (CLAUDE.md rule 5).
 */

/** Derived strategy the Core recomputes each snapshot (always-on strategy engine, docs/05). */
export interface StrategySummary {
  /** Live fuel plan (per-lap, laps remaining, to-finish, save target), or null while learning. */
  fuelPlan: FuelPlan | null;
}

export interface EngineerSnapshot {
  /** Monotonic sequence number. Gaps are expected — snapshots are throttled, not every frame. */
  seq: number;
  /** App-clock time (ms) of the source frame; the throttle samples on this. */
  monotonicMs: number;
  /** The canonical race state at this snapshot (docs/04). */
  raceState: RaceState;
  /** Derived strategy. Optional so existing snapshot consumers stay valid; the Core always sets it. */
  strategy?: StrategySummary;
  /** Events the detector fired since the previous snapshot (advisory; absent when none). */
  events?: EngineerEvent[];
}

/** The IPC channel the Core publishes snapshots on. */
export const SNAPSHOT_CHANNEL = 'engineer:snapshot' as const;

/**
 * The read-only API the preload script exposes to the renderer via `contextBridge`. The
 * renderer can only *subscribe* to snapshots — it cannot send anything toward the game.
 */
export interface EngineerBridge {
  /** Subscribe to throttled snapshots; returns an unsubscribe function. */
  onSnapshot(listener: (snapshot: EngineerSnapshot) => void): () => void;
}

/**
 * How the Engineer Core ships a snapshot out of the worker: `postMessage` in the Electron
 * utility process, a spy in tests. Keeping it an injected callback is what lets the whole Core
 * run offline with no Electron.
 */
export type SnapshotTransport = (snapshot: EngineerSnapshot) => void;
