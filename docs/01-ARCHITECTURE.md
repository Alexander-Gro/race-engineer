# 01 — Architecture

## Design goals

- **Low latency on the hot path.** The telemetry read → normalize → event loop runs at
  a fixed tick and must never block on network, disk, or the LLM.
- **Game-agnostic core.** Everything above the adapter speaks one canonical schema.
- **Voice-first, tiered.** Different responses have wildly different latency budgets;
  the architecture routes each class of output to the right mechanism.
- **Deterministic strategy, conversational delivery.** Math is separate from language.
- **Crash isolation.** A misbehaving voice provider or LLM call must not take down
  telemetry or the UI.

## Process model

Race Engineer ships as one Electron application with three logical runtimes:

```
┌──────────────────────────── Electron App ─────────────────────────────┐
│                                                                        │
│  Renderer (React/TS)            Main process (Node/TS)                 │
│  ┌────────────────────┐         ┌──────────────────────────────────┐  │
│  │ Dashboard UI        │◀──IPC──▶│ App orchestrator                 │  │
│  │ Overlay window      │  (typed │  - lifecycle, settings, secrets  │  │
│  │ Settings / mapping  │   chan- │  - window & overlay management   │  │
│  │ Strategy & setup    │   nels) │                                  │  │
│  │ Transcript / log    │         │  Worker thread / child process:  │  │
│  └────────────────────┘         │  ┌────────────────────────────┐  │  │
│                                  │  │ Engineer Core (hot path)   │  │  │
│                                  │  │  Telemetry loop @ fixed Hz │  │  │
│                                  │  │  Normalizer, Event detect  │  │  │
│                                  │  │  Strategy engine           │  │  │
│                                  │  └────────────────────────────┘  │  │
│                                  └──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
        │                         │                          │
        ▼                         ▼                          ▼
  Native FFI (koffi)        Cloud / local AI           Local SQLite
  shared memory + SDL2     (Claude, STT, TTS)          (better-sqlite3)
```

Rationale for running the Engineer Core in a **worker thread / dedicated process**:
the telemetry loop and event detection need steady timing; isolating them from the
renderer's event loop and from GC pressure in the main process keeps call-outs prompt.

## Components

Each component is defined by responsibility first; technology is assigned in
[02-TECH-STACK.md](02-TECH-STACK.md).

### 1. Telemetry Adapter (per-game)
Reads raw data from a specific game and emits it as raw frames. For LMU this means
reading the rF2 shared-memory map and polling the LMU REST API. The adapter is the
*only* code that knows game-specific struct layouts, memory names, and endpoints.
Interface: `start()`, `stop()`, `onFrame(cb)`, `capabilities()`, optional `write(cmd)`.
See [03-LMU-INTEGRATION.md](03-LMU-INTEGRATION.md).

### 2. Normalizer
Converts raw, game-specific frames into the **canonical telemetry schema**
([04-DATA-MODEL.md](04-DATA-MODEL.md)). Fixed internal tick (target 60 Hz for physics-y
values; scoring/standings update slower). Computes simple derived values (deltas, rolling
fuel-per-lap, stint timers). Produces an immutable `RaceState` snapshot per tick.

### 3. Event Detector
Consumes consecutive `RaceState` snapshots and emits discrete **events**: lap completed,
car alongside left/right, being overtaken, gap crossed threshold, flag changed, pit
entry/exit, fuel below N laps, tire temp/pressure out of window, incident, safety car.
Events carry a **priority** and a **suggested delivery tier** (see Voice).

### 4. Strategy Engine
Pure, deterministic functions over `RaceState` + history: fuel-to-finish, stint plans,
pit windows, undercut/overcut deltas, fuel-save (lift-and-coast) targets, tire
degradation projection, multi-class traffic forecasting. No I/O, no LLM. Fully unit
tested. See [05-STRATEGY-ENGINE.md](05-STRATEGY-ENGINE.md).

### 5. AI Engineer (LLM orchestration)
Wraps Anthropic Claude. Two roles:
- **Reactive** — handles driver radio: STT transcript → Claude (with tools that query
  the Strategy Engine and current `RaceState`) → spoken answer.
- **Proactive** — turns selected high-level events/strategy decisions into natural
  engineer phrasing (e.g. announcing a pit window). Low-level spotter calls bypass the
  LLM entirely. See [06-AI-ENGINEER.md](06-AI-ENGINEER.md).

### 6. Voice I/O
- **STT:** capture mic while PTT held → streaming transcription.
- **TTS:** synthesize the engineer voice; manage a priority queue so urgent spotter
  calls preempt chatter; apply radio SFX; route to chosen output device.
See [07-VOICE-IO.md](07-VOICE-IO.md).

### 7. Input Reader (read-only)
Reads wheel/controller buttons for PTT and app-side quick actions. It is passive: it
observes input but never sends any input to the game. See [08-INPUT-AND-CONTROLS.md](08-INPUT-AND-CONTROLS.md).

### 8. Setup & Aids Reader / Tuning Advisor
Reads the car's current setup and driver-aid values (read-only) so the engineer knows the
baseline, and turns driver feedback + telemetry into specific tuning *recommendations*.
The app never writes setups or settings — the driver applies every change. See
[08-INPUT-AND-CONTROLS.md](08-INPUT-AND-CONTROLS.md).

### 9. UI / Overlay
Dashboard, strategy view, setup view, settings/mapping, transcript. Plus an optional
always-on-top transparent overlay for borderless-windowed play. See [09-UI-UX.md](09-UI-UX.md).

### 10. Persistence
SQLite store of session metadata, per-lap summaries, learned fuel/tire models per
car+track+conditions, setups, and transcripts. Feeds the Strategy Engine's priors.

### 11. Config & Profiles
Per-car / per-track profiles, voice persona, button mappings, API keys (in OS secure
storage), latency/cost mode (cloud vs local).

## Data flow (one tick)

```
Adapter.readFrame()           # raw rF2 structs + REST snapshot
   → Normalizer.toRaceState() # canonical RaceState @ 60 Hz
   → EventDetector.diff(prev, next) → [Event...]
   → StrategyEngine.update(RaceState)        # cheap incremental update
        ├─ events routed by tier:
        │    tier 0 (spotter)   → Voice (pre-rendered clips) directly — never the LLM
        │    tier 1+ (strategic) → AI Engineer GENERATES the line from the event + data → Voice
        │                          (template phrasing only as a degraded fallback)
        └─ RaceState + strategy snapshot → UI (throttled to ~10–15 Hz)
   → Persistence.appendIfLapBoundary()
```

Driver radio (asynchronous to the tick):
```
PTT pressed → mic capture → STT (stream) → AI Engineer
   → Claude with read-only tools: get_race_state(), get_fuel_plan(), get_rivals(),
       project_pit_window(), get_setup_summary(), get_tire_status()
   → spoken answer/advice via Voice (the driver then makes any change themselves;
       the app may verify from telemetry that the change was applied)
```

## Latency tiers (cross-cutting)

| Tier | Example | Mechanism | Budget |
| --- | --- | --- | --- |
| 0 Reflex | "Car left", "3-wide" | Pre-rendered audio clips, no network — **never the LLM** | < 300 ms |
| 1 Proactive (strategic) | "Box this lap", "Energy's tight — save ~2% a lap" | **LLM generates from the event + data** → TTS; template phrasing only as a degraded fallback | < ~1.5 s (looser — non-reflex) |
| 2 Conversational | "Should I undercut the GTE ahead?" | STT → LLM(+read-only tools) → streaming TTS | < 2 s to first audio |
| 3 Deliberative | "Plan my whole stint sequence" | LLM with full context, may take seconds | best effort |

The Event Detector tags each event with its tier so the right path is taken without a runtime
decision in the hot loop. **Tier-0 is the only pre-rendered tier; Tiers 1–3 are LLM-generated** —
template phrasing is the *fallback* when no model is available (no key / no local model / cost cap /
offline), not the default voice (see the north star in [CLAUDE.md](../CLAUDE.md) and [docs/06](06-AI-ENGINEER.md)).

## Failure & degradation

- **No game / plugin missing:** UI shows "waiting for LMU", guided plugin-install help.
- **LLM/STT/TTS unavailable or slow:** fall back to templated audio and on-screen text;
  never stall the tick. Offer local STT/TTS modes.
- **Adapter desync (stale shared memory):** detect via version/sequence counters in the
  rF2 buffers (double-buffer / version-tick fields) and skip torn reads.
- **Cost guard:** per-session token/character budgets with a hard cap and a local-only
  fallback mode for long endurance races.

## Module boundaries (proposed packages)

```
packages/
  core/            # canonical schema, RaceState types, event types (no I/O)
  strategy/        # pure strategy math (depends on core only)
  adapters/
    lmu/           # LMU shared-memory + REST adapter
    sim-replay/    # plays recorded sessions back through the pipeline (for tests/dev)
  voice/           # STT/TTS providers + priority queue + radio SFX
  ai/              # Claude orchestration, prompts, tool definitions
  input/           # device reading + sanctioned control writes
  persistence/     # SQLite repositories + learned models
apps/
  desktop/         # Electron main + preload + React renderer (UI/overlay)
```

`core` and `strategy` are pure and portable — they would survive a later move off
Electron or even a language change of the shell. See [12-DEV-SETUP.md](12-DEV-SETUP.md)
for the full repo layout and tooling.
