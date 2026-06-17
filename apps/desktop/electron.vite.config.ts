import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * electron-vite build wiring (build-plan T6.1, the live/boot half). Bundles the three Electron
 * entry points + the renderer so `electron-vite dev` opens a window streaming the synthetic
 * `RaceState`, and `electron-vite build` emits a runnable app under `out/`:
 *   electron/main.ts            → out/main/index.js
 *   electron/engineer-worker.ts → out/main/engineer-worker.js  (utilityProcess.fork target)
 *   electron/preload.ts         → out/preload/index.js
 *   renderer/index.html         → out/renderer/index.html
 *
 * Workspace packages (`@race-engineer/*`) export raw TS (`./src/*.ts`), so they must be **bundled**
 * into the main/worker output — Electron's Node runtime can't import `.ts`. Everything else
 * (electron, zod, node built-ins) is externalized. Read-only/advisory shell: snapshots flow
 * Core → main → renderer only.
 */
// EVERY `@race-engineer/*` workspace package must be listed here: they export raw `.ts`, which
// Electron's Node runtime cannot `require`/`import` at runtime — so they must be **bundled**, not
// externalized. (Omitting one causes a runtime `ERR_MODULE_NOT_FOUND` on app launch, e.g. importing
// `@race-engineer/ai/src/tools`.) Their *real* node_modules deps (koffi, @anthropic-ai/sdk, …) stay
// external. Keep this list complete as packages are added.
const WORKSPACE_PACKAGES = [
  '@race-engineer/core',
  '@race-engineer/engineer-core',
  '@race-engineer/adapter-sim-replay',
  '@race-engineer/adapter-lmu', // bundled raw TS; its native `koffi` import stays external
  '@race-engineer/input', // bundled raw TS; its native SDL2/`koffi` import stays external
  '@race-engineer/ai',
  '@race-engineer/voice',
  '@race-engineer/radio',
  '@race-engineer/strategy',
  '@race-engineer/persistence',
  '@race-engineer/platform',
];

const bundleWorkspaceSrc = (): ReturnType<typeof externalizeDepsPlugin> =>
  externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES });

// The **preload** runs under `sandbox: true`, where the only `require` allowed is `electron` — a
// runtime `require('zod')` (or any other npm dep) throws and the preload silently fails to load, so
// NONE of the `contextBridge` APIs reach the renderer and the whole UI is dead. So the preload must be
// fully self-contained: bundle its deps (zod) in, externalizing only electron + node built-ins.
const bundlePreload = (): ReturnType<typeof externalizeDepsPlugin> =>
  externalizeDepsPlugin({ exclude: [...WORKSPACE_PACKAGES, 'zod'] });

export default defineConfig({
  main: {
    plugins: [bundleWorkspaceSrc()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          'engineer-worker': resolve(__dirname, 'electron/engineer-worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [bundlePreload()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'electron/preload.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'renderer/index.html'),
          // The in-race overlay (T6.4) — a second, separate HTML entry served by the same preload.
          overlay: resolve(__dirname, 'renderer/overlay.html'),
          // The push-to-talk "radio live" pill — a tiny bottom-centre HTML entry, shown only while held.
          'ptt-overlay': resolve(__dirname, 'renderer/ptt-overlay.html'),
        },
      },
    },
  },
});
