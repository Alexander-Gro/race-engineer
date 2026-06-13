/**
 * The per-game adapter contract (docs/01 §Components, docs/03 §The LMU Adapter). An adapter
 * is the *only* code that knows a game's raw layout; it emits raw frames that the Normalizer
 * converts into the canonical {@link RaceState}. Adapters are **read-only**: there is
 * deliberately no `write()` method — the app never writes to the game (CLAUDE.md rule 5).
 */

export type Unsubscribe = () => void;

/** A dotted path into the canonical `RaceState` (e.g. "player.fuel.liters"). */
export type CanonicalField = string;

/** What an adapter can actually provide, so the rest of the app degrades gracefully. */
export interface AdapterCapabilities {
  hasSharedMemory: boolean;
  hasRestApi: boolean;
  /** Can we read the *current* TC/ABS/brake-bias/engine-map values? */
  readsCurrentAids: boolean;
  /** Can we read the full setup (file/REST)? */
  readsSetup: boolean;
  exposesTireCompound: boolean;
  /** Which canonical fields this adapter actually populates. */
  fields: Set<CanonicalField>;
}

/**
 * A telemetry source. `TFrame` is the adapter's native frame type: for the real LMU adapter
 * these are raw rF2 structs; for `sim-replay` the frames are already canonical `RaceState`s.
 */
export interface GameAdapter<TFrame = unknown> {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Subscribe to raw frames at the adapter's native cadence. Returns an unsubscribe fn. */
  onFrame(cb: (frame: TFrame) => void): Unsubscribe;
  capabilities(): AdapterCapabilities;
}
