# 10 — Roadmap

Phased delivery. Each phase ends with a demoable, testable slice and explicit acceptance
criteria. The ordering front-loads the riskiest unknowns (telemetry + voice) before
building breadth.

> This doc is the **milestone + acceptance** view. For the granular, dependency-ordered
> task list to actually build against (one task per Claude Code session, with per-task
> verification), see [14-BUILD-PLAN.md](14-BUILD-PLAN.md). The build plan's milestones
> M0–M10 map onto these phases.
>
> **Default profile is free/local** ([15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md)):
> wherever a phase says "STT / TTS / LLM", the default target is the free local/free-tier
> provider (faster-whisper, Piper/Kokoro, local Qwen / free cloud tier / template mode).
> Cloud Claude and other paid providers are opt-in, bring-your-own-key — build the free
> path first.

## Phase 0 — De-risk & scaffold (spikes)

**Goal:** prove the integration assumptions and stand up the skeleton.

- Run spikes **S1–S4** ([03-LMU-INTEGRATION.md](03-LMU-INTEGRATION.md)): confirm
  shared-memory plugin works with current LMU, REST API shape, current-aid readability,
  and the setup file format (all read-only — there is no write channel).
- Build the **shared-memory reader** (koffi → MMF + struct decode with torn-read guard)
  and dump live values to console from a real LMU session.
- Build the **session recorder/replayer** (`adapters/sim-replay`) so all later work can
  run offline against recorded frames.
- Scaffold the monorepo (`core`, `strategy`, `adapters/lmu`, `voice`, `ai`, `input`,
  `persistence`, `apps/desktop`) per [12-DEV-SETUP.md](12-DEV-SETUP.md).

**Acceptance:** live LMU telemetry prints to console; a recorded session replays through
the Normalizer producing canonical `RaceState`; spike findings written back into doc 03.

## Phase 1 — MVP: "it talks" (vertical slice)

**Goal:** the minimum that delivers the core experience.

- LMU adapter → Normalizer → canonical `RaceState`.
- **Live Dashboard** (fuel, tires, brakes, aids, position, gaps, lap times).
- **Deterministic fuel model**: per-lap, laps-remaining, to-finish ([05](05-STRATEGY-ENGINE.md)).
- **PTT** mapped to a wheel button (SDL2) → STT → **AI Engineer** (fast Claude + tools)
  → streaming TTS. Answer "how's my fuel / last lap / who's behind me?" correctly.
- **Tier-0 spotter**: pre-rendered "car left/right" from world positions.
- Proactive **fuel-low** call-out.
- Settings: voice pick, PTT mapping, API keys, cloud mode.

**Acceptance:** in a live LMU race, ask three questions by voice and get correct spoken
answers < ~2 s; spotter "car left/right" fires < 300 ms; fuel-to-finish shown and spoken;
runs a full short race without crashing.

## Phase 2 — Endurance strategy

**Goal:** the product's reason to exist.

- **Stint planner**, **pit windows**, **undercut/overcut**, **fuel-save targets**.
- **Tire degradation** model + pace trend.
- **Multi-class traffic** awareness: faster-class-approaching and slower-class-ahead
  call-outs; pit timing vs traffic; lap-time contamination handling ([05](05-STRATEGY-ENGINE.md) §6).
- **FCY/safety-car opportunism**.
- **Learning layer**: persist + reuse fuel/tire priors per car/track/conditions.
- Strategy screen + rival tracker.
- Proactive strategy call-outs (LLM-phrased from structured data).

**Acceptance:** on replayed and live endurance races, fuel-to-finish converges within ±1
lap by mid-stint; pit recommendations match a hand-labeled "correct" call on the replay
eval set; multi-class warnings precede actual encounters with useful lead time.

## Phase 3 — Proactive coaching & in-race aid advice

**Goal:** the always-on background engineer that *advises* (no writes).

- Read **current driver aids** (TC/ABS/brake bias/engine map) so advice references the
  real baseline ([08](08-INPUT-AND-CONTROLS.md), spike S3).
- **Background strategist** ([06](06-AI-ENGINEER.md)): continuously surface confident
  opportunities — undercut/overcut windows, FCY reactions, fuel-save-unlocks-strategy.
- **Integrated coaching:** link an aid/driving tweak to a strategic outcome ("turn TC up
  two in Turn 4 to save the rears; tyres last to lap 34 and we undercut the 51").
- **Advice verification:** when the engineer suggests an aid change, watch telemetry to
  confirm the driver applied it and give feedback.
- Proactivity control (chatty ↔ only-when-it-matters ↔ silent) + quiet windows.

**Acceptance:** in a live race the engineer proactively and correctly flags an
undercut/FCY/fuel-save opportunity with useful lead time; when asked "the car won't
rotate", it answers with a specific aid/setup change referencing the current value; it
detects when the driver has applied a suggested aid change. The app sends nothing to the
game.

## Phase 4 — Setup advisory (practice)

**Goal:** the setup assistant — read-only, advice-driven.

- Read LMU **setup files** (read-only) into structured `SetupParams`; never write them.
- Setup screen showing current values by subsystem with safe ranges.
- **Handling diagnosis** from telemetry (understeer/oversteer, tire-temp spread,
  bottoming, braking stability).
- AI **setup recommendations** from complaint + telemetry (`propose_setup_change` —
  advice only); driver applies changes in the garage; app shows before/after compare.

**Acceptance:** read a real setup, get a sensible recommended change with rationale for a
stated complaint, and — after the driver applies it themselves — show a measurable
before/after telemetry difference. No setup file is ever written by the app.

## Phase 5 — Polish, packaging, robustness

**Goal:** shippable to non-technical sim racers.

- In-game **overlay** widgets; onboarding flow; plugin install helper.
- **Local/offline voice mode** (whisper.cpp + Piper) fully wired; cost estimator.
- electron-builder installer + auto-update + code signing.
- Crash isolation, graceful degradation, telemetry health UI, log/diagnostics export.
- Latency + accuracy eval suites in CI against recorded sessions.

**Acceptance:** clean install on a fresh Windows PC; guided first-run to a working radio
exchange; a multi-hour endurance race completed without intervention; documented
cloud-cost-per-hour and a working free local mode.

## Later / backlog

- **Second game** (validates the adapter abstraction): iRacing or ACC.
- Team/multi-driver endurance (driver-change planning, stint handover notes).
- Weather-forecast-aware strategy (wet/dry crossover, tire crossover laps).
- Voice persona marketplace; custom phrasing packs.
- Data-sharing opt-in for community fuel/tire priors per car/track.
- Companion view on a tablet/phone over LAN.

## Sequencing rationale

- Telemetry + voice are the make-or-break unknowns → Phase 0/1 first.
- Strategy is the value → Phase 2 before the proactive/advisory layer.
- The app is read-only/advisory throughout — there is no write-to-game phase. Phase 3
  adds the always-on coaching once the read-only product is trusted.
- Setup advisory reads a fragile file format → Phase 4, isolated, read-only.
- Packaging/local-mode last, once the experience is proven.
