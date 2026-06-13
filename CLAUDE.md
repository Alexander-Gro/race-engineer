# CLAUDE.md — Working guide for Claude Code

This file orients Claude Code when working in the **Race Engineer** repository.
Read this first, then load the specific `docs/NN-*.md` relevant to the task.

## What this project is

Race Engineer is a Windows desktop app: an **AI race engineer for sim racing**.
It reads live telemetry from racing games (first target: **Le Mans Ultimate**),
talks to the driver with an AI voice over a push-to-talk "radio" mapped to a wheel
button, and helps with **endurance strategy** and **car tuning**.

> **Windows-only — this is a hard constraint.** Windows 10/11 (x64) is the *sole* runtime,
> build, and distribution target. The maintainer develops on macOS, but macOS/Linux are
> **never** runtime targets. Do not add macOS/Linux build targets, and do not write
> Mac/Linux-specific runtime code as a feature. macOS is a development convenience for the
> OS-agnostic packages only (`core`, `strategy`, `adapters/sim-replay`, strategy/AI/event
> logic, UI rendered from fixtures). All native integration — shared memory, SDL2 input,
> audio, the installer/signing — is Windows-only and must be verified on Windows.

The product spec and engineering plan live in [docs/](docs/). The numbered files are
the source of truth. If code and docs disagree, the docs describe intent — reconcile
explicitly rather than silently diverging.

## Current state

Planning only. There is **no application code yet**. The immediate work is to validate
the riskiest integration assumptions (see "Research spikes" below) and then scaffold
the app per [docs/12-DEV-SETUP.md](docs/12-DEV-SETUP.md).

## Chosen stack (summary — full rationale in docs/02)

- **Shell + UI:** Electron + React + TypeScript + Vite + Tailwind + shadcn/ui.
- **Runtime:** Node.js (single language across the app — TypeScript everywhere).
- **Native Windows access:** `koffi` (FFI) to call `OpenFileMapping`/`MapViewOfFile`
  for shared memory, and SDL2 (via FFI or a small prebuilt addon) for wheel input.
- **AI:** Provider-swappable behind an interface, with deterministic strategy math in plain
  TypeScript (the LLM never does the math). **Default free profile:** local Qwen 3.x / a
  free cloud tier / template mode. **Optional:** Anthropic Claude (or any provider) via the
  user's own key. See [docs/15-COST-AND-FREE-OPERATION.md](docs/15-COST-AND-FREE-OPERATION.md).
- **Voice:** Local-first by default — **faster-whisper** (STT) + **Piper/Kokoro** (TTS),
  free and offline. Cloud STT/TTS (Deepgram / OpenAI / ElevenLabs / Azure) is opt-in,
  bring-your-own-key.
- **Storage:** SQLite via `better-sqlite3`.

If a task implies a different stack, check [docs/02-TECH-STACK.md](docs/02-TECH-STACK.md)
for the alternatives matrix before switching — the language choice for the telemetry
core is the one decision most likely to be revisited.

## Architectural rules (do not violate without updating docs)

1. **The LLM never computes numbers.** Fuel, stint, pit, and degradation math are pure,
   unit-tested TypeScript functions. The LLM *calls* them as tools and phrases results.
2. **Tiered latency for voice** (see docs/06). Spotter call-outs ("car left") must be
   pre-rendered/templated audio, never a live LLM round-trip. Strategic answers may use
   the LLM. Never block the telemetry loop on network I/O.
3. **The telemetry read loop is the hot path.** Keep it allocation-light and off the UI
   thread. Normalize raw game structs into the canonical schema in [docs/04-DATA-MODEL.md](docs/04-DATA-MODEL.md)
   immediately; nothing downstream should know about rF2/LMU struct layouts.
4. **Per-game code is isolated behind an adapter interface.** Game-specific structs,
   memory names, and quirks live only in `adapters/<game>/`. The rest of the app speaks
   the canonical schema.
5. **The app is read-only and advisory — it never changes anything in the game.** It
   reads telemetry and the car's current setup/aids so it can *tell* the driver exactly
   what to change; the driver makes every change themselves. No input injection, no
   settings writes, no driving automation, no `HWControl`/`SendInput`. There is no
   write path in the architecture. See [docs/11-RISKS-AND-COMPLIANCE.md](docs/11-RISKS-AND-COMPLIANCE.md).
6. **Free, open-source, local-first — no embedded secrets, no central server.** The app is
   a client-side desktop app published on GitHub; the publisher must never incur inference
   cost. Ship a free local profile that runs with no key; make every cloud provider opt-in,
   bring-your-own-key, stored only in OS secure storage. Never commit a key, ship a shared
   credential, or run a paid backend proxy. See [docs/15-COST-AND-FREE-OPERATION.md](docs/15-COST-AND-FREE-OPERATION.md).

## Research spikes that gate implementation

These assumptions must be verified against a live LMU install before committing to the
designs that depend on them. Track them in [docs/03-LMU-INTEGRATION.md](docs/03-LMU-INTEGRATION.md):

- **S1** — Confirm the rF2 Shared Memory Map plugin (The Iron Wolf) works with the
  current LMU build and which memory-mapped files/fields are populated.
- **S2** — Confirm LMU's local REST API: port, endpoints, what session/standings/setup
  data it exposes, whether it is read-only.
- **S3** — Confirm the current TC/ABS/brake-bias/engine-map values are *readable*
  (telemetry/extended buffer or setup file) — the engineer needs the baseline to advise
  from. (We never write these.)
- **S4** — Confirm the LMU/rF2 setup file location and format for **read-only** parsing
  (and/or whether the REST API exposes setup state). We never write setups.
- **S5–S8** — Platform/distribution spikes (plugin license & auto-install, SDL2 wheel read
  while the game owns the device, local-model bundle-vs-download, OSS code signing). See
  [docs/16-PLATFORM-PREREQUISITES.md](docs/16-PLATFORM-PREREQUISITES.md).

## Conventions

- Language: TypeScript, strict mode. Prefer pure functions for anything testable.
- Tests: Vitest. Strategy-engine math must have unit tests with worked examples from
  [docs/05-STRATEGY-ENGINE.md](docs/05-STRATEGY-ENGINE.md).
- Commits: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`). This repo is not
  yet a git repository — initialize it before the first code change.
- Secrets: API keys live in OS-level secure storage, never in the repo or logs.

## How to help effectively here

- For planning/architecture changes, edit the relevant `docs/NN-*.md` and keep the
  README doc index in sync.
- For implementation, work the **dependency-ordered task list** in
  [docs/14-BUILD-PLAN.md](docs/14-BUILD-PLAN.md): pick the lowest-numbered unblocked task,
  load the docs it lists as Context, make its Verify step pass, commit. ([docs/10-ROADMAP.md](docs/10-ROADMAP.md)
  gives the product-milestone view and acceptance gates.)
- Build the replay/synthetic data source early (task T0.4) so strategy, events, AI, and UI
  are all testable offline without LMU running.
- When unsure about an LMU-specific detail, mark it as a spike to verify rather than
  guessing — the engine internals are version-sensitive.
