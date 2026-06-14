import type { MicSource } from '../types';

/**
 * In-memory {@link MicSource} for tests. {@link MockMicSource.emit} pushes a word as an audio
 * frame to the active capture; it's a no-op when the mic isn't started, which lets a test prove
 * PTT gating (frames outside begin/end are dropped).
 */
export class MockMicSource implements MicSource {
  started = false;
  #onFrame: ((frame: Uint8Array) => void) | null = null;

  start(onFrame: (frame: Uint8Array) => void): void {
    this.#onFrame = onFrame;
    this.started = true;
  }

  stop(): void {
    this.#onFrame = null;
    this.started = false;
  }

  /** Test helper: emit one word as an audio frame (no-op unless started). */
  emit(word: string): void {
    this.#onFrame?.(new TextEncoder().encode(word));
  }
}
