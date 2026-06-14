import {
  type ActionBinding,
  type ButtonEdge,
  type ButtonRef,
  type InputAction,
  buttonKey,
} from './types';

/**
 * The button→action map (docs/08 §1). Invariants: one action per button, and one button per
 * action (re-binding an action moves it to the new button). Serializable so the settings store
 * (T6.3) can persist mappings. No game state — this only routes app behaviour.
 */
export class BindingSet {
  readonly #byButton = new Map<string, ActionBinding>();

  /** Bind a button to an action, replacing any prior binding for either side. */
  set(binding: ActionBinding): void {
    for (const [key, b] of this.#byButton) {
      if (b.action === binding.action) this.#byButton.delete(key); // one button per action
    }
    this.#byButton.set(buttonKey(binding.button), binding); // one action per button
  }

  /** The action bound to a button, or null. */
  get(button: ButtonRef): InputAction | null {
    return this.#byButton.get(buttonKey(button))?.action ?? null;
  }

  forAction(action: InputAction): ActionBinding | null {
    for (const b of this.#byButton.values()) if (b.action === action) return b;
    return null;
  }

  clearAction(action: InputAction): void {
    for (const [key, b] of this.#byButton) if (b.action === action) this.#byButton.delete(key);
  }

  list(): ActionBinding[] {
    return [...this.#byButton.values()];
  }

  toJSON(): ActionBinding[] {
    return this.list();
  }

  static fromJSON(items: readonly ActionBinding[]): BindingSet {
    const set = new BindingSet();
    for (const b of items) set.set(b);
    return set;
  }
}

/**
 * Press-to-map capture (docs/08 §1 mapping flow): while active, the first DOWN edge across any
 * device is captured as the button to bind. Pure — the reader resolves the device name and
 * stores the {@link ActionBinding}.
 */
export class ButtonCapture {
  #active = false;

  start(): void {
    this.#active = true;
  }

  cancel(): void {
    this.#active = false;
  }

  get active(): boolean {
    return this.#active;
  }

  /** Returns the first DOWN edge's button (consuming it and stopping capture), else null. */
  feed(edges: readonly ButtonEdge[]): ButtonRef | null {
    if (!this.#active) return null;
    for (const edge of edges) {
      if (edge.kind === 'down') {
        this.#active = false;
        return edge.button;
      }
    }
    return null;
  }
}
