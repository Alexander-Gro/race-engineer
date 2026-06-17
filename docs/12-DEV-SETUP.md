# 12 — Developer Setup

How the repo is structured, how to build it, and how to develop without launching the
game every time.

## Prerequisites

- **Windows 10/11 (x64) — the only runtime, build, and distribution target.** Required for
  shared memory, SDL2 input, audio, LMU, and the signed installer. macOS/Linux are **not**
  shipped. You *can* develop the OS-agnostic packages (`core`, `strategy`, `sim-replay`,
  strategy/AI/event logic, UI from fixtures) on macOS/Linux against recordings — but anything
  native or runtime-facing must be built and tested on Windows. Don't add cross-platform
  build targets.
- **Node.js** LTS + **pnpm** (monorepo-friendly package manager).
- **Le Mans Ultimate** installed, plus the **rF2 Shared Memory Map plugin** installed in
  LMU's plugins folder (see [03-LMU-INTEGRATION.md](03-LMU-INTEGRATION.md), spike S1).
- A sim wheel/controller (for PTT) — or use a keyboard binding while developing.
- API keys for Claude + chosen STT/TTS providers (or local models for offline dev).
- Build tools for any native addon fallback (Visual Studio Build Tools) — only if we add
  an N-API addon; the koffi-FFI path needs no compilation.
- **For the free local profile:** Ollama (local-LLM route) and the local model files
  (faster-whisper / Piper / Kokoro) — downloaded on first run, not committed. GPU STT also
  needs CUDA/cuDNN (CPU fallback otherwise). See [16-PLATFORM-PREREQUISITES.md](16-PLATFORM-PREREQUISITES.md).
- **Distribution:** code signing (target SignPath Foundation — free for OSS), a
  `THIRD-PARTY`/`NOTICE` file for bundled licenses, and an affiliation disclaimer. Set the
  OSS license (MIT/Apache-2.0) before the first public commit. Add single-instance lock.
  Permissions, signing, and system requirements are all in [16-PLATFORM-PREREQUISITES.md](16-PLATFORM-PREREQUISITES.md).

## Proposed repository layout (monorepo)

```
race-engineer/
├─ CLAUDE.md
├─ README.md
├─ docs/                      # the numbered plan (source of truth)
├─ package.json               # workspace root
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ packages/
│  ├─ core/                   # canonical schema, RaceState/event types (pure, no I/O)
│  ├─ strategy/               # pure strategy math (depends on core); unit-tested
│  ├─ adapters/
│  │  ├─ lmu/                 # shared-memory reader + REST client + struct decoders
│  │  └─ sim-replay/          # record/replay raw frames for offline dev & tests
│  ├─ voice/                  # STT/TTS providers, priority queue, radio SFX
│  ├─ ai/                     # Claude orchestration, prompts, tool defs
│  ├─ input/                  # SDL2 device reader for PTT/quick-actions (read-only; no game writes)
│  └─ persistence/            # SQLite repositories + learned models
└─ apps/
   └─ desktop/                # Electron: main, preload, React renderer (UI + overlay)
```

Dependency direction: `core` ← everything; `strategy` depends only on `core`; adapters,
voice, ai, input, persistence depend on `core` (+ their domain); `apps/desktop` wires it
all. Keep `core` and `strategy` pure so they survive a shell/runtime change.

## Scripts (indicative)

```
pnpm install
pnpm dev            # run Electron in dev (Vite HMR for renderer)
pnpm build          # build all packages
pnpm test           # vitest across packages
pnpm test:replay    # run strategy/event tests against recorded sessions
pnpm lint           # eslint + prettier check
pnpm typecheck      # tsc --noEmit across workspace
pnpm dist           # electron-builder installer (Windows)
pnpm record         # capture a live LMU session to a replay file
pnpm replay <file>  # play a recording through the full pipeline
```

## Develop without the game (replay-first workflow)

The single most important productivity tool: the **sim-replay adapter**.
1. Once, with LMU running, `pnpm record` captures raw frames to a file.
2. Thereafter, `pnpm replay <file>` feeds those frames through Normalizer → events →
   strategy → UI/voice, deterministically and offline.

This lets you build and test strategy, events, dashboards, and voice phrasing without
starting LMU, and gives reproducible fixtures for CI.

## Testing strategy

- **Unit (Vitest):** strategy math (worked examples from [05](05-STRATEGY-ENGINE.md)),
  normalizer conversions, event debounce/cooldown, tool result shapes.
- **Replay/integration:** recorded sessions → assert strategy outputs at known moments
  (fuel-to-finish ±1 lap by mid-stint; pit call matches hand-labeled correct call).
- **Latency harness:** measure STT→first-audio and event-trigger→audio per provider;
  enforce tier budgets.
- **AI hallucination guard:** assert every number the model speaks appears in a tool
  result that turn.
- **UI (Playwright):** dashboards render from fixture `RaceState`; settings/mapping flows.
- **Torn-read tests:** simulated mid-write buffers must be skipped, never decoded.

## Secrets & config

- API keys entered in-app, stored via Electron `safeStorage` (Windows DPAPI). For local
  dev, support a git-ignored `.env.local`; never commit keys; never log them.
- Per-user config (mappings, voice, mode, budgets) in the app's userData dir; profiles
  per car/track in SQLite.

## Coding conventions

- TypeScript strict; prefer pure functions for anything in `core`/`strategy`.
- Keep all game-specific knowledge inside `adapters/lmu` — the rest of the app imports
  only `core` types.
- Conventional commits; small vertical slices aligned to [10-ROADMAP.md](10-ROADMAP.md).
- Document any spike finding back into [03-LMU-INTEGRATION.md](03-LMU-INTEGRATION.md).

## First steps for a new contributor (or Claude Code)

1. Read [CLAUDE.md](../CLAUDE.md) and [00-OVERVIEW.md](00-OVERVIEW.md) → [01-ARCHITECTURE.md](01-ARCHITECTURE.md).
2. Pick the current phase in [10-ROADMAP.md](10-ROADMAP.md).
3. If pre-Phase-1, do the spikes in [03-LMU-INTEGRATION.md](03-LMU-INTEGRATION.md) and
   build the shared-memory reader + replay harness first.
4. Build the smallest slice that produces visible/audible output; test against a recording.

> This repo is not yet a git repository. Initialize it (`git init`) before the first code
> change so the scaffolding and spike findings are versioned from the start.
