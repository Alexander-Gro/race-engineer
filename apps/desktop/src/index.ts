// @race-engineer/desktop
// Electron main + preload + renderer (UI + overlay). See docs/09.
// T6.1 lands the shell: the Electron entry (electron/) hosts the Engineer Core in a worker /
// utility process and forwards throttled RaceState snapshots to the renderer over typed IPC.
// The Electron-agnostic wiring lives here in src/ so it stays unit-testable with no Electron.
export * from './single-instance';
export { createSyntheticEngineerCore } from './host';
export type { EngineerHostOptions } from './host';
