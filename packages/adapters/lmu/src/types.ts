import type { ScoringFrame, TelemetryFrame } from './shm/structs';

/**
 * The LMU adapter's native frame: one torn-read-guarded sample of the shared-memory buffers.
 * This is the raw, game-specific shape that {@link GameAdapter} emits; the LMU Normalizer
 * (T2.3) converts it into the canonical `RaceState`. Nothing outside `adapters/lmu` should
 * reference this type (canonical-schema boundary, CLAUDE.md rule 3).
 *
 * `scoring` is always present on an emitted frame (the adapter skips polls where scoring is
 * unavailable — game not in session, or a torn read); `telemetry` may be null on the odd
 * tick where only scoring decoded cleanly.
 */
export interface LmuRawFrame {
  /** Monotonic frame counter assigned by the adapter. */
  tick: number;
  /** App-clock timestamp (ms) when sampled. */
  monotonicMs: number;
  scoring: ScoringFrame;
  telemetry: TelemetryFrame | null;
}
