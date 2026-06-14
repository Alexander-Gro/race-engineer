# @race-engineer/desktop

The Electron desktop shell (build-plan **T6.1**). Windows is the only runtime target
(see [CLAUDE.md](../../CLAUDE.md)); macOS is a dev convenience for the OS-agnostic parts.

## Layout

| Path | Typechecked by `pnpm typecheck`? | What it is |
| --- | --- | --- |
| `src/host.ts` | ✅ yes | **Electron-agnostic** Engineer Core wiring (synthetic source → throttled snapshots). Unit-tested, no Electron. |
| `src/single-instance.ts` | ✅ yes | Single-instance lock decision (testable; wired to Electron in `electron/main.ts`). |
| `electron/main.ts` | ⛔ no (needs `electron`) | Main process: creates the window, forks the Engineer Core **worker**, forwards snapshots to the renderer over typed IPC. |
| `electron/preload.ts` | ⛔ no | Exposes the **read-only** `EngineerBridge` to the renderer via `contextBridge`. |
| `electron/engineer-worker.ts` | ⛔ no | Utility-process worker: runs the tick pipeline off the UI thread, `postMessage`s throttled snapshots. |
| `renderer/` | ⛔ no | Minimal renderer that paints the live values (the styled dashboard is T6.2). |

The hot-path logic — the pipeline, the ~10–15 Hz snapshot throttle, the typed IPC contract —
lives in [`@race-engineer/engineer-core`](../../packages/engineer-core) and `src/host.ts`, and
is **fully unit-tested offline** with the synthetic source (no Electron, no game). The files
under `electron/` and `renderer/` are the Electron entry points; they reference `electron`,
which is not installed in CI, so they are excluded from the workspace typecheck.

## Running the shell (the T6.1 live/visual verify — human)

Booting an actual Electron window can't be done headlessly, so it's a manual step:

```sh
# 1. Add Electron + a renderer bundler (the docs/02 stack uses Vite).
pnpm --filter @race-engineer/desktop add -D electron electron-vite vite

# 2. Wire electron-vite (entry points: electron/main.ts, electron/preload.ts,
#    electron/engineer-worker.ts, renderer/index.html), then:
pnpm --filter @race-engineer/desktop dev:electron

# 3. Typecheck the Electron entry points (once electron is installed):
pnpm --filter @race-engineer/desktop typecheck:electron
```

**Expected:** the window opens and shows evolving values (position, fuel, last lap, laps
remaining) streamed from the synthetic source at ~12 Hz — proving the Adapter → Normalizer →
throttle → IPC → renderer pipe end to end. Swap the source in `src/host.ts`
(`syntheticAdapter` → the LMU adapter + `createLmuNormalizer`) to drive it from a live session.

The shell is **read-only/advisory**: snapshots flow Core → main → renderer only; there is no
channel from the renderer toward the game.
