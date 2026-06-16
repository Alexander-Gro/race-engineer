import koffi from 'koffi';
import type { ButtonRef, DeviceInfo, InputBackend } from '../types';

/**
 * Windows-only SDL2 joystick backend (docs/08 §1). Reads wheels/button-boxes **passively** via
 * koffi FFI — enumerate devices and poll button state without grabbing them, so the game still
 * receives all input. There is no write path; we never send input (CLAUDE.md rule 5).
 *
 * SCAFFOLD — requires `SDL2.dll` at runtime and **must be live-verified on the Windows rig with
 * a real wheel**; it cannot run on the macOS dev box (koffi loads the DLL lazily in the
 * constructor, so importing this module for typecheck is harmless). Completion items for the
 * rig are marked `TODO(rig)`:
 *  - stable device identity via `SDL_JoystickGetGUIDString` (instead of name#index, which is
 *    not stable across reconnects);
 *  - hot-plug handling (re-enumerate on SDL_JOYDEVICEADDED/REMOVED).
 */

const SDL_INIT_VIDEO = 0x0000_0020;
const SDL_INIT_JOYSTICK = 0x0000_0200;

// koffi pointer handles are opaque to us; we only hand them back to SDL.
type NativePtr = unknown;

interface Sdl2Lib {
  SDL_SetHint: (name: string, value: string) => number;
  SDL_Init: (flags: number) => number;
  SDL_Quit: () => void;
  SDL_PumpEvents: () => void;
  SDL_JoystickUpdate: () => void;
  SDL_NumJoysticks: () => number;
  SDL_JoystickOpen: (index: number) => NativePtr;
  SDL_JoystickClose: (joystick: NativePtr) => void;
  SDL_JoystickName: (joystick: NativePtr) => string | null;
  SDL_JoystickNumButtons: (joystick: NativePtr) => number;
  SDL_JoystickGetButton: (joystick: NativePtr, button: number) => number;
}

const loadSdl2 = (libPath: string): Sdl2Lib => {
  const lib = koffi.load(libPath);
  return {
    SDL_SetHint: lib.func('SDL_SetHint', 'int', ['str', 'str']) as Sdl2Lib['SDL_SetHint'],
    SDL_Init: lib.func('SDL_Init', 'int', ['uint32']) as Sdl2Lib['SDL_Init'],
    SDL_Quit: lib.func('SDL_Quit', 'void', []) as Sdl2Lib['SDL_Quit'],
    SDL_PumpEvents: lib.func('SDL_PumpEvents', 'void', []) as Sdl2Lib['SDL_PumpEvents'],
    SDL_JoystickUpdate: lib.func('SDL_JoystickUpdate', 'void', []) as Sdl2Lib['SDL_JoystickUpdate'],
    SDL_NumJoysticks: lib.func('SDL_NumJoysticks', 'int', []) as Sdl2Lib['SDL_NumJoysticks'],
    SDL_JoystickOpen: lib.func('SDL_JoystickOpen', 'void*', ['int']) as Sdl2Lib['SDL_JoystickOpen'],
    SDL_JoystickClose: lib.func('SDL_JoystickClose', 'void', [
      'void*',
    ]) as Sdl2Lib['SDL_JoystickClose'],
    SDL_JoystickName: lib.func('SDL_JoystickName', 'str', ['void*']) as Sdl2Lib['SDL_JoystickName'],
    SDL_JoystickNumButtons: lib.func('SDL_JoystickNumButtons', 'int', [
      'void*',
    ]) as Sdl2Lib['SDL_JoystickNumButtons'],
    SDL_JoystickGetButton: lib.func('SDL_JoystickGetButton', 'uint8', [
      'void*',
      'int',
    ]) as Sdl2Lib['SDL_JoystickGetButton'],
  };
};

interface OpenJoystick {
  handle: NativePtr;
  name: string;
  guid: string;
  buttonCount: number;
}

export class Sdl2Backend implements InputBackend {
  readonly name = 'sdl2';
  readonly #sdl: Sdl2Lib;
  #joysticks: OpenJoystick[] = [];

  constructor(libPath = 'SDL2.dll') {
    this.#sdl = loadSdl2(libPath);
    // Hints must precede SDL_Init. Force DirectInput (pollable) over the default RAWINPUT driver, and
    // allow reads while another app (the game) has focus — we only ever *read* the device (rule 5).
    this.#sdl.SDL_SetHint('SDL_JOYSTICK_RAWINPUT', '0');
    this.#sdl.SDL_SetHint('SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS', '1');
    // VIDEO is required alongside JOYSTICK: it creates SDL's hidden message-only window + event pump
    // that Windows device input needs. JOYSTICK alone enumerates devices but never sees button state
    // in a process without its own message loop (rig-verified 2026-06-16 with a Fanatec wheel).
    if (this.#sdl.SDL_Init(SDL_INIT_VIDEO | SDL_INIT_JOYSTICK) !== 0) {
      throw new Error('SDL_Init(SDL_INIT_VIDEO | SDL_INIT_JOYSTICK) failed');
    }
    this.#enumerate();
  }

  #enumerate(): void {
    this.#joysticks = [];
    const count = this.#sdl.SDL_NumJoysticks();
    for (let i = 0; i < count; i += 1) {
      const handle = this.#sdl.SDL_JoystickOpen(i);
      if (!handle) continue;
      const name = this.#sdl.SDL_JoystickName(handle) ?? `Device ${i}`;
      const buttonCount = this.#sdl.SDL_JoystickNumButtons(handle);
      // TODO(rig): use SDL_JoystickGetGUIDString for identity stable across reconnects.
      this.#joysticks.push({ handle, name, guid: `${name}#${i}`, buttonCount });
    }
  }

  listDevices(): DeviceInfo[] {
    return this.#joysticks.map((j) => ({ guid: j.guid, name: j.name, buttonCount: j.buttonCount }));
  }

  pollPressed(): ButtonRef[] {
    this.#sdl.SDL_PumpEvents(); // drain the OS message queue so device state is fresh (Windows)
    this.#sdl.SDL_JoystickUpdate();
    const pressed: ButtonRef[] = [];
    for (const j of this.#joysticks) {
      for (let b = 0; b < j.buttonCount; b += 1) {
        if (this.#sdl.SDL_JoystickGetButton(j.handle, b) === 1) {
          pressed.push({ deviceGuid: j.guid, buttonIndex: b });
        }
      }
    }
    return pressed;
  }

  close(): void {
    for (const j of this.#joysticks) this.#sdl.SDL_JoystickClose(j.handle);
    this.#joysticks = [];
    this.#sdl.SDL_Quit();
  }
}
