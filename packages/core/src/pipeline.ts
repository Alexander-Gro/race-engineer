import type { GameAdapter } from './adapter';
import type { Normalizer } from './normalize';
import type { RaceState } from './schema';

/**
 * The tick pipeline (docs/01 §Data flow): Adapter → (torn-read guard) → Normalizer →
 * canonical `RaceState` stream. It is pure wiring over the adapter/normalizer contracts with
 * no I/O of its own, so it runs identically against the sim-replay source (now) and a live
 * adapter inside the Engineer Core worker later (T6.1).
 */
export interface PipelineOptions<TFrame> {
  adapter: GameAdapter<TFrame>;
  normalizer: Normalizer<TFrame>;
  /** Called with each normalized snapshot. Must stay cheap — it runs on the hot path. */
  onState: (state: RaceState) => void;
  /**
   * Torn-read guard hook: return false to drop a torn/incomplete raw frame before it is
   * normalized (docs/03 §Reading correctly). sim-replay frames are always stable; the LMU
   * adapter supplies a real guard based on rF2 version/sequence counters.
   */
  isFrameStable?: (frame: TFrame) => boolean;
  /** Notified when a frame is dropped by the guard (e.g. for diagnostics/metrics). */
  onDroppedFrame?: (frame: TFrame) => void;
}

/**
 * Wire an adapter to a normalizer and drive it to completion. Resolves when the adapter's
 * stream ends (finite sources like replay/synthetic) or after it is stopped (live sources).
 */
export const runPipeline = async <TFrame>(options: PipelineOptions<TFrame>): Promise<void> => {
  const { adapter, normalizer, onState, isFrameStable, onDroppedFrame } = options;

  const unsubscribe = adapter.onFrame((frame) => {
    if (isFrameStable && !isFrameStable(frame)) {
      onDroppedFrame?.(frame);
      return;
    }
    onState(normalizer.toRaceState(frame));
  });

  try {
    await adapter.start();
  } finally {
    unsubscribe();
  }
};
