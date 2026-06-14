import { type ButtonRef, type ButtonEdge, buttonKey } from './types';

/**
 * Turns a stream of polled pressed-button snapshots into clean DOWN/UP edges with **lockout
 * debounce** (docs/08 §1 "debounce; emit clean DOWN/UP edge events"): once an edge is accepted
 * for a button, further transitions on that button are ignored for `debounceMs` to swallow
 * mechanical contact bounce. Pure and allocation-light — it runs on the input poll loop.
 */

const DEFAULT_DEBOUNCE_MS = 30;

interface ButtonState {
  ref: ButtonRef;
  down: boolean;
  lastEdgeMs: number;
}

export class EdgeDetector {
  readonly #debounceMs: number;
  readonly #state = new Map<string, ButtonState>();

  constructor(debounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this.#debounceMs = Math.max(0, debounceMs);
  }

  /** Feed the current pressed set; returns the accepted (debounced) edges this poll. */
  update(pressed: readonly ButtonRef[], atMs: number): ButtonEdge[] {
    const currentKeys = new Set<string>();
    const refByKey = new Map<string, ButtonRef>();
    for (const ref of pressed) {
      const key = buttonKey(ref);
      currentKeys.add(key);
      refByKey.set(key, ref);
    }

    const edges: ButtonEdge[] = [];
    const keys = new Set<string>([...this.#state.keys(), ...currentKeys]);
    for (const key of keys) {
      const isDown = currentKeys.has(key);
      const prev = this.#state.get(key);
      const wasDown = prev?.down ?? false;
      if (isDown === wasDown) continue;
      if (prev && atMs - prev.lastEdgeMs < this.#debounceMs) continue; // within lockout — bounce
      const ref = prev?.ref ?? refByKey.get(key);
      if (!ref) continue; // unreachable (key came from one of the two maps)
      this.#state.set(key, { ref, down: isDown, lastEdgeMs: atMs });
      edges.push({ button: ref, kind: isDown ? 'down' : 'up', atMs });
    }
    return edges;
  }

  reset(): void {
    this.#state.clear();
  }
}
