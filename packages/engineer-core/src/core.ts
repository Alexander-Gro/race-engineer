import {
  EventDetector,
  runPipeline,
  type EngineerEvent,
  type EventRule,
  type GameAdapter,
  type Normalizer,
  type RaceState,
} from '@race-engineer/core';
import { defaultEventRules } from './event-rules';
import type { EngineerSnapshot, SnapshotTransport } from './ipc';
import { StrategyEngine } from './strategy';
import { intervalForHz, Throttle } from './throttle';

/**
 * The headless Engineer Core (docs/01 §Data flow, build-plan T6.1). It drives the tick pipeline
 * (Adapter → torn-read guard → Normalizer → canonical `RaceState`) and pushes **throttled**
 * snapshots out through a {@link SnapshotTransport}.
 *
 * In the desktop app it runs in a worker / utility process and the transport is `postMessage`;
 * in tests the source is the sim-replay/synthetic adapter and the transport is a spy — so the
 * whole brain is exercised offline with no Electron and no game running. Read-only/advisory: it
 * consumes telemetry and emits snapshots; there is no write path to the game (CLAUDE.md rule 5).
 */
export interface EngineerCoreOptions<TFrame> {
  adapter: GameAdapter<TFrame>;
  normalizer: Normalizer<TFrame>;
  /** Ships a snapshot toward the renderer. */
  transport: SnapshotTransport;
  /** Snapshot rate to the UI. Default 12 Hz (docs/01: ~10–15 Hz). */
  snapshotHz?: number;
  /** Torn-read guard, forwarded to the pipeline (docs/03 §Reading correctly). */
  isFrameStable?: (frame: TFrame) => boolean;
  /** Event Detector rules. Default {@link defaultEventRules}; pass `[]` to disable detection. */
  eventRules?: readonly EventRule[];
}

const DEFAULT_SNAPSHOT_HZ = 12;

export class EngineerCore<TFrame> {
  readonly #options: EngineerCoreOptions<TFrame>;
  readonly #strategy = new StrategyEngine();
  readonly #detector: EventDetector;
  /** Events fired since the last emitted snapshot (drained on emit). */
  #pendingEvents: EngineerEvent[] = [];
  #seq = 0;

  constructor(options: EngineerCoreOptions<TFrame>) {
    this.#options = options;
    this.#detector = new EventDetector(options.eventRules ?? defaultEventRules());
  }

  /** Snapshots emitted so far. */
  get snapshotsSent(): number {
    return this.#seq;
  }

  /**
   * Run the pipeline to completion (finite replay/synthetic sources) or until {@link stop} (live
   * sources). Snapshots are throttled to `snapshotHz`, and the **final** state is always flushed
   * so the renderer settles on the latest live values even if it fell inside a throttle window.
   */
  async start(): Promise<void> {
    const { adapter, normalizer, isFrameStable, snapshotHz } = this.#options;
    const throttle = new Throttle<RaceState>(
      intervalForHz(snapshotHz ?? DEFAULT_SNAPSHOT_HZ),
      (state) => state.monotonicMs,
    );
    // Held in an object: a `let` assigned only inside the callback would be narrowed to `null`
    // by control-flow analysis after the loop (the closure write is invisible to CFA).
    const tail: { state: RaceState | null; lastSentMs: number | null } = {
      state: null,
      lastSentMs: null,
    };

    await runPipeline({
      adapter,
      normalizer,
      isFrameStable,
      onState: (state) => {
        tail.state = state;
        // Run per tick: strategy needs every lap boundary; the detector's cooldown/dedupe is
        // measured on the full-rate clock. Events buffer until the next throttled snapshot.
        this.#strategy.observe(state);
        const events = this.#detector.process(state);
        if (events.length > 0) this.#pendingEvents.push(...events);
        if (throttle.accept(state)) {
          this.#emit(state);
          tail.lastSentMs = state.monotonicMs;
        }
      },
    });

    // Flush the final state so the UI always ends on the latest values, not a stale throttle tick.
    if (tail.state !== null && tail.state.monotonicMs !== tail.lastSentMs) this.#emit(tail.state);
  }

  /** Stop a live source. Finite sources end on their own. */
  async stop(): Promise<void> {
    await this.#options.adapter.stop();
  }

  #emit(state: RaceState): void {
    const events = this.#pendingEvents;
    this.#pendingEvents = [];
    const snapshot: EngineerSnapshot = {
      seq: this.#seq,
      monotonicMs: state.monotonicMs,
      raceState: state,
      strategy: this.#strategy.summary(state),
      ...(events.length > 0 ? { events } : {}),
    };
    this.#seq += 1;
    this.#options.transport(snapshot);
  }
}
