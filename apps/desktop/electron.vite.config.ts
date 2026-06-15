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
const bundleWorkspaceSrc = (): ReturnType<typeof externalizeDepsPlugin> =>
  externalizeDepsPlugin({
    exclude: [
      '@race-engineer/core',
      '@race-engineer/engineer-core',
      '@race-engineer/adapter-sim-replay',
      // Bundled (raw TS) but their native `koffi` imports stay external (real node_modules addons):
      // the LMU shared-memory adapter and the SDL2 push-to-talk reader (T10.1 PTT mapping).
      '@race-engineer/adapter-lmu',
      '@race-engineer/input',
    ],
  });

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
    plugins: [bundleWorkspaceSrc()],
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
        },
      },
    },
  },
});
