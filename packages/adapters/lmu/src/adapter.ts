import type { AdapterCapabilities, GameAdapter, Unsubscribe } from '@race-engineer/core';
import { lmuCapabilities } from './capabilities';
import { openShmReader, type ShmReader } from './shm/reader';
import type { LmuRawFrame } from './types';

/**
 * Production LMU telemetry source (docs/03 §The LMU Adapter, build-plan T2.1). Wraps the
 * torn-read-guarded shared-memory reader (S1, live-confirmed) behind the canonical
 * {@link GameAdapter} contract and polls it at a steady cadence. **Read-only** — it only opens
 * the read maps; there is no `write()` and no control buffer is ever touched (CLAUDE.md rule 5).
 *
 * The reader is injectable so the poll/emit/lifecycle logic is unit-testable off-Windows with
 * a fake; the real `openShmReader` (koffi → Win32 MMF) only runs on the rig with LMU up.
 */

const DEFAULT_HZ = 50;

export interface LmuAdapterOptions {
  /** Poll rate in Hz (default 50). Physics-y values update fast; scoring updates slower. */
  hz?: number;
  /** Reader factory — defaults to the live shared-memory reader; injected in tests. */
  openReader?: () => ShmReader;
  /** App clock for frame timestamps (default `Date.now`). */
  now?: () => number;
  id?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class LmuAdapter implements GameAdapter<LmuRawFrame> {
  readonly id: string;
  readonly #hz: number;
  readonly #openReader: () => ShmReader;
  readonly #now: () => number;
  readonly #listeners = new Set<(frame: LmuRawFrame) => void>();
  #reader: ShmReader | null = null;
  #running = false;
  #tick = 0;

  constructor(options: LmuAdapterOptions = {}) {
    this.#hz = Math.max(1, options.hz ?? DEFAULT_HZ);
    this.#openReader = options.openReader ?? openShmReader;
    this.#now = options.now ?? ((): number => Date.now());
    this.id = options.id ?? 'lmu';
  }

  capabilities(): AdapterCapabilities {
    return lmuCapabilities();
  }

  onFrame(cb: (frame: LmuRawFrame) => void): Unsubscribe {
    this.#listeners.add(cb);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  /**
   * Read one frame from the open reader (torn-guarded inside the reader). Returns null when
   * scoring isn't available yet — game not in a session, or this poll was a torn read.
   */
  poll(): LmuRawFrame | null {
    const reader = this.#reader;
    if (!reader) return null;
    const scoring = reader.readScoring();
    if (!scoring) return null;
    return {
      tick: this.#tick++,
      monotonicMs: this.#now(),
      scoring,
      telemetry: reader.readTelemetry(),
    };
  }

  /** Open the reader and poll until {@link stop} (live source — resolves when stopped). */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#reader = this.#openReader();
    this.#running = true;
    const intervalMs = 1000 / this.#hz;
    try {
      while (this.#running) {
        const frame = this.poll();
        if (frame) {
          for (const listener of this.#listeners) listener(frame);
        }
        await sleep(intervalMs);
      }
    } finally {
      this.#reader?.close();
      this.#reader = null;
    }
  }

  async stop(): Promise<void> {
    this.#running = false;
  }
}

/** Convenience factory mirroring the sim-replay adapter's helpers. */
export const lmuAdapter = (options: LmuAdapterOptions = {}): LmuAdapter => new LmuAdapter(options);
