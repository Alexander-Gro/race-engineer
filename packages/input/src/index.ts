// @race-engineer/input
// Read-only wheel/controller reader for push-to-talk + app-side quick actions (docs/08 §1).
// Passive and non-exclusive — it never sends input to the game (CLAUDE.md rule 5). All
// edge/debounce/binding logic is backend-agnostic and unit-tested with a mock; the SDL2
// backend is the Windows-only live half.
export type {
  ButtonRef,
  DeviceInfo,
  ButtonEdge,
  InputAction,
  ActionBinding,
  InputBackend,
} from './types';
export { buttonKey, APP_ACTIONS } from './types';
export { EdgeDetector } from './edges';
export { BindingSet, ButtonCapture } from './bindings';
export { InputReader } from './reader';
export type { InputReaderOptions, InputReaderEvents } from './reader';
export { MockBackend } from './backends/mock';
// Windows-only; loads SDL2.dll at construction (not on import). Live-verify on the rig.
export { Sdl2Backend } from './backends/sdl2';
