import type { RaceState } from '@race-engineer/core';
import { writeReplayFile } from './replay-file';
import { serializeReplay } from './replay';

/**
 * Records a canonical `RaceState` stream to the replay format (build-plan T2.4). Game-agnostic:
 * it captures whatever the pipeline emits (live LMU via the recorder CLI, or any source), so a
 * real session can be saved and later replayed offline through the full pipeline — replacing
 * synthetic fixtures and giving deterministic regression tests (docs/03 §Validation harness).
 *
 * Read-only with respect to the game: it only observes the normalized state stream. The output
 * round-trips exactly through `parseReplay`/`readReplayFile` (same serializer).
 */
export interface RecorderOptions {
  /** Stop accepting frames after this many (default: unbounded). The CLI sets a stint cap. */
  maxFrames?: number;
}

export class Recorder {
  readonly #frames: RaceState[] = [];
  readonly #max: number;
  #truncated = false;

  constructor(options: RecorderOptions = {}) {
    this.#max = options.maxFrames ?? Number.POSITIVE_INFINITY;
  }

  /** Capture one frame. Silently ignored (and flagged {@link truncated}) once the cap is hit. */
  add(frame: RaceState): void {
    if (this.#frames.length >= this.#max) {
      this.#truncated = true;
      return;
    }
    this.#frames.push(frame);
  }

  get count(): number {
    return this.#frames.length;
  }

  /** True if frames were dropped because the cap was reached (so callers don't over-claim). */
  get truncated(): boolean {
    return this.#truncated;
  }

  get frames(): readonly RaceState[] {
    return this.#frames;
  }

  /** Serialize captured frames to the JSON-Lines replay format. */
  serialize(): string {
    return serializeReplay([...this.#frames]);
  }

  /** Write captured frames to a replay file (`pnpm replay <file>` reads it back). */
  async save(path: string): Promise<void> {
    await writeReplayFile(path, [...this.#frames]);
  }
}
