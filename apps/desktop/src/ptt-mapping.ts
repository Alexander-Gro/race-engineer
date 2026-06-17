import type { ActionBinding, ButtonRef } from '@race-engineer/input';

/**
 * Push-to-talk mapping flow (build-plan T10.1 PTT-mapping UI, docs/08 §1 "Mapping flow"):
 *
 *   user clicks "Map push-to-talk"
 *     → app listens for the next button press across all devices
 *     → captures { deviceGuid, deviceName, buttonIndex }
 *     → stores the binding; the renderer confirms which button was bound
 *
 * The reading is **passive and non-exclusive** — the same `InputReader`/`InputBackend` used for live PTT
 * (T4.1). There is **no write path to the game** (CLAUDE.md rule 5): we observe a button so the driver
 * can key the radio; we never send input.
 *
 * This module is the **Electron-agnostic core**: the {@link PttMapper} coordinator + the renderer↔main
 * IPC contract, written over injected ports (an {@link PttMapperOptions.openReader} factory, an emit
 * callback, a persist callback, an app clock, a timer scheduler) so the whole capture flow is
 * unit-testable in Node with a `MockBackend`-backed reader and a stepped clock — no Electron, no
 * hardware. Imports from `@race-engineer/input` are **type-only** so this module pulls no input runtime
 * into the bundle: the Electron `main` constructs the real reader (SDL2 on the Windows rig) behind a
 * **dynamic import**, so the default synthetic demo never loads the native `koffi`/SDL2 addon. `main`
 * persists the captured button into {@link AppSettings.ptt}; capturing a **real wheel button** is the
 * rig human-assisted half (on the dev box the reader has no devices, so the flow runs but times out).
 */

// ── renderer ↔ main IPC channels ───────────────────────────────────────────────────────────────────
/** Renderer → main: arm capture (the next button press binds PTT). */
export const PTT_MAP_BEGIN_CHANNEL = 'ptt:map-begin' as const;
/** Renderer → main: stop listening without binding. */
export const PTT_MAP_CANCEL_CHANNEL = 'ptt:map-cancel' as const;
/** Renderer → main: clear the current PTT binding (back to the text-box-only fallback). */
export const PTT_MAP_CLEAR_CHANNEL = 'ptt:map-clear' as const;
/** Renderer → main: read the current binding for display. */
export const PTT_GET_CHANNEL = 'ptt:get' as const;
/** Main → renderer (push): mapping-flow progress (listening / captured / cancelled / error). */
export const PTT_EVENT_CHANNEL = 'ptt:event' as const;
/** Main → renderer (push): a **live** PTT edge from the mapped hardware button (T4.1 runtime read).
 *  Drives the radio exactly like the on-screen hold-to-talk button — `true` = pressed, `false` = released. */
export const PTT_LIVE_CHANNEL = 'ptt:live' as const;

/** Progress of a mapping attempt, pushed main → renderer so the UI can reflect it live. */
export type PttMappingEvent =
  | { type: 'listening' }
  | { type: 'captured'; deviceGuid: string; buttonIndex: number; deviceName: string }
  | { type: 'cancelled'; reason: 'user' | 'timeout' }
  | { type: 'error'; message: string };

/** The current binding plus a pre-formatted display label (so the renderer pulls no input runtime). */
export interface PttBindingInfo {
  ptt: ButtonRef | null;
  label: string;
}

/** The `window.ptt` bridge the preload exposes (read-only/advisory — config only, no game path). */
export interface PttApi {
  /** Arm capture: the next button press binds PTT. Resolves once listening has started. */
  beginMapping(): Promise<void>;
  /** Stop listening without binding. */
  cancelMapping(): Promise<void>;
  /** Clear the binding; resolves with the (now-empty) binding info. */
  clearMapping(): Promise<PttBindingInfo>;
  /** The current binding for display. */
  getBinding(): Promise<PttBindingInfo>;
  /** Subscribe to mapping-flow events; returns an unsubscribe. */
  onMappingEvent(listener: (event: PttMappingEvent) => void): () => void;
  /** Subscribe to **live** PTT edges from the mapped hardware button (drives the radio); unsubscribe. */
  onLivePtt(listener: (down: boolean) => void): () => void;
}

/** A glanceable label for a binding ("Mock Wheel · button 4" / "Unmapped"). Pure — safe in the renderer. */
export const formatPttBinding = (ptt: ButtonRef | null, deviceName?: string): string => {
  if (!ptt) return 'Unmapped';
  const device = deviceName && deviceName.length > 0 ? deviceName : ptt.deviceGuid;
  return `${device} · button ${ptt.buttonIndex}`;
};

/** Timer port — injected so tests step the listen loop by hand instead of waiting on real intervals. */
export interface MapperScheduler {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultScheduler = (): MapperScheduler => {
  const g = globalThis as {
    setInterval?: (callback: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
  };
  return {
    setInterval: (callback, ms) => {
      if (!g.setInterval) throw new Error('PttMapper: no setInterval on this runtime');
      return g.setInterval(callback, ms);
    },
    clearInterval: (handle) => g.clearInterval?.(handle),
  };
};

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const DEFAULT_TIMEOUT_MS = 10_000; // give up listening after ~10 s with no press
const DEFAULT_POLL_HZ = 120; // docs/08 §1: 100–125 Hz is plenty for button edges

/** A device reader, already armed to capture the next press. Closing releases the device. */
export interface ReaderHandle {
  /** One poll cycle — reads the device and may fire the capture callback. */
  poll(): void;
  /** Release the device (passive read only — no write path was ever opened). */
  close(): void;
}

export interface PttMapperOptions {
  /**
   * Open a fresh device reader, armed for press-to-map, that calls `onMapped` on the first captured
   * button. Built fresh each time mapping begins — re-enumerating devices catches a just-plugged wheel,
   * and nothing native is touched until the user actually maps. May be async so the caller can
   * **dynamically import** the Windows-only SDL2 reader off the default path (keeping `koffi` lazy).
   */
  openReader: (onMapped: (binding: ActionBinding) => void) => ReaderHandle | Promise<ReaderHandle>;
  /** Persist the captured button (Electron `main` writes it into {@link AppSettings.ptt}). */
  onCaptured: (ptt: ButtonRef) => void;
  /** Push a mapping-flow event to the renderer. */
  emit: (event: PttMappingEvent) => void;
  /** App clock; defaults to `Date.now`. Injected in tests for a deterministic timeout. */
  now?: () => number;
  /** Listen window before giving up (ms). Default 10 s. */
  timeoutMs?: number;
  /** Listen-loop poll rate (Hz). Default 120. */
  pollHz?: number;
  /** Timer port; defaults to global `setInterval`/`clearInterval`. */
  scheduler?: MapperScheduler;
}

/**
 * Coordinates one "press a button to map PTT" attempt over an {@link InputReader}. While listening it
 * polls the device at ~120 Hz; the first debounced DOWN edge is captured (via the reader's press-to-map),
 * persisted, and reported as `captured`. A user cancel or a timeout reports `cancelled`; a backend that
 * won't open (e.g. SDL2 missing) reports `error` — it **never throws into the loop** (docs/16 §never
 * crash). One attempt at a time; the backend is opened on `begin` and closed on every exit.
 */
export class PttMapper {
  readonly #openReader: PttMapperOptions['openReader'];
  readonly #onCaptured: (ptt: ButtonRef) => void;
  readonly #emit: (event: PttMappingEvent) => void;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollHz: number;
  readonly #scheduler: MapperScheduler;

  #handle: ReaderHandle | null = null;
  #timer: unknown = null;
  #listening = false;
  #starting = false;
  #listeningSinceMs = 0;

  constructor(opts: PttMapperOptions) {
    this.#openReader = opts.openReader;
    this.#onCaptured = opts.onCaptured;
    this.#emit = opts.emit;
    this.#now = opts.now ?? ((): number => Date.now());
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#pollHz = opts.pollHz ?? DEFAULT_POLL_HZ;
    this.#scheduler = opts.scheduler ?? defaultScheduler();
  }

  get listening(): boolean {
    return this.#listening;
  }

  /** Arm capture: open a reader in press-to-map, then start the listen loop. */
  async begin(): Promise<void> {
    if (this.#listening || this.#starting) return;
    this.#starting = true;
    let handle: ReaderHandle;
    try {
      handle = await this.#openReader((binding) => this.#capture(binding));
    } catch (err) {
      this.#starting = false;
      this.#emit({ type: 'error', message: errorMessage(err) });
      return;
    }
    if (!this.#starting) {
      // cancel()/dispose() raced the reader open — discard it and stay idle.
      handle.close();
      return;
    }
    this.#handle = handle;
    this.#listening = true;
    this.#starting = false;
    this.#listeningSinceMs = this.#now();
    this.#emit({ type: 'listening' });
    this.#timer = this.#scheduler.setInterval(
      () => this.poll(),
      Math.max(1, Math.round(1000 / this.#pollHz)),
    );
  }

  /** One listen cycle: poll the device (may capture), then enforce the timeout. Tests call this. */
  poll(): void {
    if (!this.#listening || !this.#handle) return;
    this.#handle.poll(); // a DOWN edge here fires onMapped → #capture → finish
    if (this.#listening && this.#now() - this.#listeningSinceMs >= this.#timeoutMs) {
      this.#finish({ type: 'cancelled', reason: 'timeout' });
    }
  }

  /** Stop listening without binding. */
  cancel(): void {
    this.#starting = false; // abort an in-flight begin()
    if (this.#listening) this.#finish({ type: 'cancelled', reason: 'user' });
  }

  /** Release any device/timer (app shutdown). */
  dispose(): void {
    this.#starting = false;
    if (this.#listening) this.#teardown();
  }

  #capture(binding: ActionBinding): void {
    this.#onCaptured(binding.button); // persist first, then confirm to the UI
    this.#finish({
      type: 'captured',
      deviceGuid: binding.button.deviceGuid,
      buttonIndex: binding.button.buttonIndex,
      deviceName: binding.deviceName,
    });
  }

  #finish(event: PttMappingEvent): void {
    this.#teardown();
    this.#emit(event);
  }

  #teardown(): void {
    if (this.#timer !== null) {
      this.#scheduler.clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#handle?.close(); // releases the device (no write path was ever opened)
    this.#handle = null;
    this.#listening = false;
  }
}
