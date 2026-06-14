import { type ButtonRef, type DeviceInfo, type InputBackend, buttonKey } from '../types';

/**
 * In-memory {@link InputBackend} for tests — drive button state directly, no hardware. Lets the
 * edge/debounce/binding/PTT logic be fully unit-tested (the T4.1 Verify: "logic/debounce unit
 * tests with a mock device").
 */
export class MockBackend implements InputBackend {
  readonly name = 'mock';
  readonly #devices: DeviceInfo[];
  #pressed: ButtonRef[] = [];

  constructor(
    devices: DeviceInfo[] = [{ guid: 'mock-wheel', name: 'Mock Wheel', buttonCount: 24 }],
  ) {
    this.#devices = devices;
  }

  listDevices(): DeviceInfo[] {
    return this.#devices;
  }

  pollPressed(): ButtonRef[] {
    return this.#pressed;
  }

  /** Replace the whole pressed set. */
  setPressed(buttons: readonly ButtonRef[]): void {
    this.#pressed = [...buttons];
  }

  press(button: ButtonRef): void {
    if (!this.#pressed.some((b) => buttonKey(b) === buttonKey(button))) {
      this.#pressed = [...this.#pressed, button];
    }
  }

  release(button: ButtonRef): void {
    this.#pressed = this.#pressed.filter((b) => buttonKey(b) !== buttonKey(button));
  }

  close(): void {
    this.#pressed = [];
  }
}
