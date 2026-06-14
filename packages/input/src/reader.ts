import { BindingSet, ButtonCapture } from './bindings';
import { EdgeDetector } from './edges';
import type { ActionBinding, ButtonEdge, ButtonRef, InputAction, InputBackend } from './types';

/**
 * Ties a device {@link InputBackend} to debounced edges, press-to-map, and action dispatch
 * (docs/08 §1). Runs on its own poll loop, **independent of the telemetry hot path**. Pure
 * routing: PTT edges key the radio, quick actions fire on press; nothing is ever sent to the
 * game.
 *
 * For tests, drive {@link InputReader.poll} manually with a mock backend + injected clock; the
 * timer-driven {@link InputReader.start} is the production loop.
 */

export interface InputReaderEvents {
  /** PTT button down (true) / up (false). */
  onPtt?: (down: boolean, atMs: number) => void;
  /** A non-PTT app action fired (on press). */
  onAction?: (action: InputAction, button: ButtonRef, atMs: number) => void;
  /** Press-to-map completed and stored a binding. */
  onMapped?: (binding: ActionBinding) => void;
  /** Every debounced edge (debug/UI "pressed" indicator). */
  onEdge?: (edge: ButtonEdge) => void;
}

export interface InputReaderOptions {
  backend: InputBackend;
  bindings?: BindingSet;
  debounceMs?: number;
  /** App clock; defaults to `Date.now`. Injected in tests for determinism. */
  now?: () => number;
  events?: InputReaderEvents;
}

const DEFAULT_POLL_HZ = 120; // docs/08 §1: 100–125 Hz is plenty for button edges

export class InputReader {
  readonly #backend: InputBackend;
  readonly #edges: EdgeDetector;
  readonly #capture = new ButtonCapture();
  readonly #bindings: BindingSet;
  readonly #now: () => number;
  readonly #events: InputReaderEvents;
  readonly #deviceNames = new Map<string, string>();
  #mappingAction: InputAction | null = null;
  #timer: unknown = null;

  constructor(opts: InputReaderOptions) {
    this.#backend = opts.backend;
    this.#edges = new EdgeDetector(opts.debounceMs);
    this.#bindings = opts.bindings ?? new BindingSet();
    this.#now = opts.now ?? ((): number => Date.now());
    this.#events = opts.events ?? {};
    this.#refreshDevices();
  }

  get bindings(): BindingSet {
    return this.#bindings;
  }

  /** The action currently being mapped, or null. */
  get mapping(): InputAction | null {
    return this.#mappingAction;
  }

  /** Enter press-to-map: the next button press binds to `action`. */
  beginMapping(action: InputAction): void {
    this.#mappingAction = action;
    this.#capture.start();
  }

  cancelMapping(): void {
    this.#mappingAction = null;
    this.#capture.cancel();
  }

  /** One poll cycle: read the backend, debounce, then capture-or-dispatch each edge. */
  poll(): void {
    const atMs = this.#now();
    const edges = this.#edges.update(this.#backend.pollPressed(), atMs);
    for (const edge of edges) {
      this.#events.onEdge?.(edge);
      if (this.#mappingAction && edge.kind === 'down') {
        const captured = this.#capture.feed([edge]);
        if (captured) {
          const deviceName = this.#deviceNames.get(captured.deviceGuid) ?? captured.deviceGuid;
          const binding: ActionBinding = {
            action: this.#mappingAction,
            button: captured,
            deviceName,
          };
          this.#bindings.set(binding);
          this.#mappingAction = null;
          this.#events.onMapped?.(binding);
        }
        continue; // consumed for mapping — do not dispatch
      }
      this.#dispatch(edge, atMs);
    }
  }

  #dispatch(edge: ButtonEdge, atMs: number): void {
    const action = this.#bindings.get(edge.button);
    if (action === 'ptt') {
      this.#events.onPtt?.(edge.kind === 'down', atMs);
      return;
    }
    if (action && edge.kind === 'down') {
      this.#events.onAction?.(action, edge.button, atMs);
    }
  }

  #refreshDevices(): void {
    this.#deviceNames.clear();
    for (const d of this.#backend.listDevices()) this.#deviceNames.set(d.guid, d.name);
  }

  /** Start the production poll loop. Tests use {@link poll} instead. */
  start(rateHz: number = DEFAULT_POLL_HZ): void {
    const g = globalThis as { setInterval?: (cb: () => void, ms: number) => unknown };
    if (!g.setInterval) throw new Error('InputReader.start: no setInterval on this runtime');
    this.#refreshDevices();
    this.#timer = g.setInterval(
      () => {
        this.poll();
      },
      Math.max(1, Math.round(1000 / rateHz)),
    );
  }

  stop(): void {
    const g = globalThis as { clearInterval?: (handle: unknown) => void };
    if (this.#timer !== null && g.clearInterval) g.clearInterval(this.#timer);
    this.#timer = null;
    this.#backend.close();
  }
}
