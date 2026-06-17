# Race Engineer

An AI race engineer for sim racing. Race Engineer connects to racing simulators,
reads live telemetry, and acts as a voice-driven race engineer that helps you with
**endurance strategy**, **car tuning**, and **real-time situational awareness**
(positions, gaps, fuel, tires, brakes, driver aids).

The first supported game is **Le Mans Ultimate (LMU)**.

> **Platform: Windows 10/11 (x64) only.** Race Engineer ships, runs, and is distributed only
> on Windows — that is where the sims and their telemetry/input interfaces live. macOS and
> Linux are **not** runtime targets. (Development can happen on any OS for the OS-agnostic
> parts — see [12-DEV-SETUP](docs/12-DEV-SETUP.md) — but the product is Windows-only.)

> **Read-only and advisory by design.** Race Engineer never changes anything in the game.
> It reads telemetry and the car's current setup so it can *tell you exactly what to
> change* — you make every change yourself. No input injection, no settings writes, no
> driving automation.

> Status: **Planning / pre-implementation.** This repository currently contains the
> full product and engineering plan. No application code has been written yet.

---

## What it does (target product)

- **Live telemetry** — Reads fuel, per-wheel tire temps/pressures/wear, brake temps,
  TC / ABS / brake-bias / engine-map settings, lap/sector times, positions and gaps
  directly from the running game.
- **Voice race engineer** — Talks to you with an AI voice. You map a button on your
  wheel as a **push-to-talk radio**, hold it, and ask questions ("How's my fuel?",
  "When should I box?", "The car won't rotate into the corner — what do I change?"). It
  answers in natural speech.
- **Knows your car** — It already knows your full setup and current aids, so when you
  describe a handling problem it tells you the precise change to make ("move brake bias
  back two clicks for rotation on entry").
- **Endurance strategy** — Fuel/stint planning, pit windows, undercut/overcut math,
  fuel-save targets, tire-degradation modeling, multi-class traffic management. It works
  the strategy continuously in the background and jumps on the radio when it spots an
  opportunity.
- **Anticipatory traffic** — Proactive call-outs from the live data: a faster class
  closing, blue flags, a slower car ahead in a braking zone, pit-window reminders. (No
  instant "car alongside" proximity call — that split-second awareness stays with the
  driver's eyes and mirrors.)

It advises; it never acts on the car for you.

## How to read this repo

Start at [docs/00-OVERVIEW.md](docs/00-OVERVIEW.md), then follow the numbered docs.
Each document is scoped so it can be loaded into Claude Code as focused context.

| Doc | Purpose |
| --- | --- |
| [00-OVERVIEW](docs/00-OVERVIEW.md) | Vision, goals, personas, scope, MVP definition |
| [01-ARCHITECTURE](docs/01-ARCHITECTURE.md) | System components, processes, data flow |
| [02-TECH-STACK](docs/02-TECH-STACK.md) | Chosen stack, rationale, alternatives |
| [03-LMU-INTEGRATION](docs/03-LMU-INTEGRATION.md) | Le Mans Ultimate telemetry & setup reading (read-only) |
| [04-DATA-MODEL](docs/04-DATA-MODEL.md) | Canonical telemetry schema, events, persistence |
| [05-STRATEGY-ENGINE](docs/05-STRATEGY-ENGINE.md) | Fuel / tire / pit / multi-class math specs |
| [06-AI-ENGINEER](docs/06-AI-ENGINEER.md) | LLM design, prompts, tools, latency tiers |
| [07-VOICE-IO](docs/07-VOICE-IO.md) | Speech-to-text, text-to-speech, push-to-talk |
| [08-INPUT-AND-CONTROLS](docs/08-INPUT-AND-CONTROLS.md) | Wheel input (PTT), reading setup/aids, tuning advice |
| [09-UI-UX](docs/09-UI-UX.md) | Screens, in-game overlay, dashboards |
| [10-ROADMAP](docs/10-ROADMAP.md) | Phased milestones with acceptance criteria |
| [11-RISKS-AND-COMPLIANCE](docs/11-RISKS-AND-COMPLIANCE.md) | Read-only stance, latency, cost, privacy |
| [12-DEV-SETUP](docs/12-DEV-SETUP.md) | Environment, repo structure, scripts, testing |
| [13-GLOSSARY](docs/13-GLOSSARY.md) | Sim racing + project terms |
| [14-BUILD-PLAN](docs/14-BUILD-PLAN.md) | Dependency-ordered build sequence for Claude Code |
| [15-COST-AND-FREE-OPERATION](docs/15-COST-AND-FREE-OPERATION.md) | Free/local-first operation, BYO-key, no-surprise-bill design |
| [16-PLATFORM-PREREQUISITES](docs/16-PLATFORM-PREREQUISITES.md) | OS permissions, audio, local-model setup, signing, system requirements, legal |

See [CLAUDE.md](CLAUDE.md) for instructions to Claude Code working in this repo.

## Quick mental model

```
   Le Mans Ultimate ──(shared memory + local REST, READ-ONLY)──▶ Telemetry + Setup Adapter
                                                                          │
                                                                          ▼
                                                          Normalizer → Race State (60 Hz)
                                                                          │
                                          ┌───────────────────────────────┼───────────────────────────────┐
                                          ▼                               ▼                               ▼
                                  Strategy Engine                  Event Detector                   Telemetry UI
                                  (fuel/tire/pit,                  (overtakes, flags,               (dashboard +
                                   undercut/overcut)                gaps, opportunities)             overlay)
                                          └───────────────┬───────────────┘
                                                          ▼
   Wheel PTT button ─▶ Input Reader ─▶ Voice I/O ─▶ AI Engineer (Claude + read-only tools) ─▶ Voice I/O
                       (read-only)     (mic / STT)                                            (TTS — advice only)
```

Nothing flows back into the game. The engineer's only output to the driver is its voice
(and the on-screen dashboard).

## Installing (Windows)

Race Engineer is a **Windows 10/11 (x64)** desktop app. Grab `Race Engineer-<version>-setup.exe`
(installer) or `-portable.exe` (no install) from the releases, or build it yourself:

```
pnpm install
pnpm --filter @race-engineer/desktop dist:win   # → apps/desktop/dist/
```

> **First run shows a SmartScreen warning — this is expected.** The app is **unsigned** (we ship
> without a code-signing certificate, by choice — it keeps the project free; see
> [docs/16](docs/16-PLATFORM-PREREQUISITES.md)). When Windows says *"Windows protected your PC,"*
> click **More info → Run anyway**. If your antivirus flags it, that's a false positive on an
> unsigned app that reads game memory and the mic — allow it, or build from source above.

## Free & open-source

Race Engineer is built to be **free to run and free to publish**. It is a client-side
desktop app: there is no server and no shared key, so the publisher's inference cost is
**$0 regardless of user count**. The default profile runs entirely on free local models
(no key, offline-capable); cloud providers are opt-in and **bring-your-own-key**, stored
only in OS secure storage. No secret is ever committed to the repo. See
[15-COST-AND-FREE-OPERATION](docs/15-COST-AND-FREE-OPERATION.md).

## License & disclaimer

Race Engineer is licensed under the **Apache License 2.0** — see [LICENSE](LICENSE),
[NOTICE](NOTICE), and [THIRD-PARTY.md](THIRD-PARTY.md). Race
Engineer is strictly **read-only and advisory**: it reads sanctioned telemetry interfaces
and the car's setup, then *tells* the driver what to change. It never writes to the game,
never changes settings or driver aids, and never automates driving. See
[11-RISKS-AND-COMPLIANCE](docs/11-RISKS-AND-COMPLIANCE.md) and, for permissions / signing /
system requirements, [16-PLATFORM-PREREQUISITES](docs/16-PLATFORM-PREREQUISITES.md).

Race Engineer is an independent project and is **not affiliated with, endorsed by, or
sponsored by** Le Mans Ultimate, Studio 397, or Motorsport Games.
