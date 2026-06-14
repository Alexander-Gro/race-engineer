/**
 * Input-reading contracts (docs/08 §1). The app reads wheel/controller buttons **passively**
 * to drive itself (push-to-talk + app-side quick actions); it never sends input to the game
 * and never grabs a device exclusively (CLAUDE.md rule 5 — there is no write path).
 *
 * These types are device-backend-agnostic: the SDL2 backend (Windows) and the test mock both
 * implement {@link InputBackend}, so all the edge/debounce/binding logic is unit-testable with
 * no hardware.
 */

/** A physical button: a device GUID plus the button's index on that device. */
export interface ButtonRef {
  deviceGuid: string;
  buttonIndex: number;
}

/** Stable string key for a button (set membership / binding lookup). */
export const buttonKey = (b: ButtonRef): string => `${b.deviceGuid}#${b.buttonIndex}`;

export interface DeviceInfo {
  guid: string;
  name: string;
  buttonCount: number;
}

/** A debounced button transition. */
export interface ButtonEdge {
  button: ButtonRef;
  kind: 'down' | 'up';
  /** App-clock time (ms) the edge was accepted. */
  atMs: number;
}

/**
 * App-side actions a bound button can trigger (docs/08 §1). `ptt` keys the radio; the rest are
 * app-only conveniences. **None of these send anything to the game.**
 */
export type InputAction = 'ptt' | 'repeat_last' | 'acknowledge_box' | 'next_strategy_view';

export const APP_ACTIONS: readonly InputAction[] = [
  'ptt',
  'repeat_last',
  'acknowledge_box',
  'next_strategy_view',
];

/** A button bound to an action, with the device name captured for display. */
export interface ActionBinding {
  action: InputAction;
  button: ButtonRef;
  deviceName: string;
}

/**
 * A source of button state. Passive and non-exclusive: it observes; the game still receives
 * all input. Implemented by the SDL2 backend (Windows) and the test mock.
 */
export interface InputBackend {
  readonly name: string;
  listDevices(): DeviceInfo[];
  /** Buttons pressed right now, across all devices. */
  pollPressed(): ButtonRef[];
  /** Release native resources. */
  close(): void;
}
