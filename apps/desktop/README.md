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
| `electron.vite.config.ts` | ⛔ no | electron-vite build wiring (entry points → `out/`). |

The hot-path logic — the pipeline, the ~10–15 Hz snapshot throttle, the typed IPC contract —
lives in [`@race-engineer/engineer-core`](../../packages/engineer-core) and `src/host.ts`, and
is **fully unit-tested offline** with the synthetic source (no Electron, no game). The files
under `electron/` and `renderer/` are the Electron entry points; they reference `electron`, so
they are excluded from the workspace `typecheck` (run `pnpm --filter @race-engineer/desktop
typecheck:electron` to typecheck them) — but they **do** build via electron-vite (`build:electron`).

## Running the shell (the T6.1 live/visual verify — human)

The toolchain is wired (`electron` + `electron-vite`); booting an actual window needs a display,
so it's a manual step on a dev machine (macOS is fine — the synthetic source needs no game):

```sh
# 1. Fetch the Electron binary (CI/this repo skip it via ELECTRON_SKIP_BINARY_DOWNLOAD).
pnpm install

# 2. Dev — opens a window with HMR, streaming the synthetic RaceState:
pnpm --filter @race-engineer/desktop dev

# 3. LIVE — drive the dashboard from a real LMU session (Windows rig, LMU running with the
#    shared-memory plugin). Selects the LMU source via ENGINEER_SOURCE=lmu:
pnpm dev:lmu      # (or: pnpm --filter @race-engineer/desktop dev:lmu)

# Or build a runnable bundle (no display needed for the build itself) and preview it:
pnpm --filter @race-engineer/desktop build:electron
pnpm --filter @race-engineer/desktop preview

# Typecheck the Electron entry points:
pnpm --filter @race-engineer/desktop typecheck:electron
```

**Expected (`dev`):** the window opens and shows evolving values (position, fuel, last lap, laps
remaining) streamed from the **synthetic** source at ~12 Hz — proving the Adapter → Normalizer →
throttle → IPC → renderer pipe end to end.

**Live (`dev:lmu`):** the worker dynamically loads the LMU shared-memory source (`src/lmu-host.ts`,
koffi — Windows-only) instead. With LMU running it streams your **real** telemetry; until LMU is in
a session it waits (the dashboard shows "Waiting…", and the worker logs the status to the terminal).
Fields the SHM normalizer doesn't map yet (brakes, TC/ABS, …) render as "—" until the REST merge
(T2.2) lands. The source choice is the **only** difference — the same pipeline drives both.

> First-boot notes (dev machine): `build:electron` is verified green here; the window boot
> itself is the human step. If the renderer's `Content-Security-Policy` (in `renderer/index.html`)
> blocks Vite's dev HMR, relax it for dev or test against `build:electron` + `preview`.

The shell is **read-only/advisory**: snapshots flow Core → main → renderer only; there is no
channel from the renderer toward the game.
