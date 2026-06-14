# 14 — Build Plan (for Claude Code)

A granular, dependency-ordered implementation sequence. Where [10-ROADMAP.md](10-ROADMAP.md)
defines *product milestones and acceptance*, this doc defines the *order to write code* and
how each step is verified — sized so **each task is one focused Claude Code session** ending
in a small, reviewable, green-tested change.

## How to use this plan

- **One task per session.** Pick the lowest-numbered unblocked task. Load the docs listed
  in its **Context** line, implement, make its **Verify** step pass, commit.
- **Branch + commit.** This repo isn't a git repo yet — task **T0.1** initializes it.
  Thereafter: one branch per task, conventional commits (`feat:`, `fix:`, `test:`…), small
  PRs.
- **Definition of Done (global):** `pnpm typecheck && pnpm lint && pnpm test` are green; new
  logic has unit tests; no secrets committed; docs updated if behavior diverges from them.
- **Replay-first verification.** Most tasks are verified offline against recorded or
  synthetic telemetry — no game required. Tasks that *do* need LMU, a wheel, audio, or API
  keys are marked **[human-assisted]** and call out exactly what the user must do.
- **Free/local-first.** Build the free providers first (faster-whisper, Piper/Kokoro, local
  Qwen / free cloud tier / template mode); cloud Claude and other paid providers are opt-in,
  bring-your-own-key, added behind the same interface later. Never commit a key or add a
  central server. See [15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md).

## Build progress

> Living status for session handoff. A fresh chat (no prior context) can resume by reading
> this section, then running `/build-task` with no argument — which picks the lowest-numbered
> unblocked task. Keep it updated as tasks land; cross-check against `git log` (commits are
> tagged with task IDs, e.g. `feat: T3.2 …`).

- **Done:** T0.1–T0.7 (M0 foundations: repo, monorepo, canonical schema, sim-replay +
  synthetic source, pipeline/Normalizer + `inspect` CLI, CI, OSS/Apache-2.0 hygiene),
  T1.1 (S1 raw shared-memory dump — **live-confirmed on the rig 2026-06-14**; see
  [03-LMU-INTEGRATION](03-LMU-INTEGRATION.md) §"S1 — live confirmation"), T3.1 (fuel model),
  T3.2 (event detector core + framework), T3.3 (persistence: SQLite `sessions`/`laps`/
  `fuel_models` via better-sqlite3 + learning-priors layer that seeds the fuel model).
- **Next up — Track A (offline, no game needed):** T3.4 (spotter geometry — works on
  synthetic positions) → then M5 (AI radio loop) toward the MVP gate.
- **Track B (needs the Windows rig + LMU):** T1.2–T1.5 (REST probe, aids/setup reads, record
  a real session). Optional next rig step: a moving, multi-class session to confirm dynamic
  fields + the real Hypercar/LMP2/GTE class strings for T2.3.

## The central ordering idea

```
Native + game-dependent work (the spikes) needs a Windows PC + LMU + a wheel.
Everything else (schema, strategy, events, AI, voice logic, UI) is platform-independent
and testable against fixtures — IF a replay/mock data source exists first.

  ⇒ Build the canonical schema + a synthetic/replay data source FIRST (M0).
    That unblocks ~70% of the codebase to be built and tested with no game running,
    in parallel with the human-assisted spikes (M1).
```

**Critical path:** `M0 scaffold+schema+replay → M3 fuel/events → M5 AI radio loop → MVP`.
The LMU adapter (M1/M2) feeds real data in, but the logic above it is developed against
recordings, so a delay getting the plugin working does not block strategy/AI/UI work.

## Parallelization

Two tracks can run at once:
- **Track A (Claude Code, any OS):** M0 → M3 → M5 → M6 logic against synthetic/recorded data.
- **Track B (human + Claude Code on the Windows rig):** M1 spikes → M2 real adapter, then
  hand a real recording to Track A to replace synthetic fixtures.

They converge at the MVP gate (end of M5).

---

## M0 — Foundations (no game; fully testable)

**T0.1 — Initialize repo & hygiene** · _Claude Code_
Build: `git init`; `.gitignore` (node, dist, `.env*`, recordings dir policy); LICENSE
placeholder; PR/commit conventions note; `.editorconfig`.
Verify: `git status` clean after initial commit; hooks/lint config present.
Context: [12-DEV-SETUP](12-DEV-SETUP.md), [CLAUDE.md](../CLAUDE.md).

**T0.2 — Scaffold pnpm monorepo + tooling** · _Claude Code_ · deps: T0.1
Build: pnpm workspace; `tsconfig.base.json` (strict); ESLint+Prettier; Vitest; empty
packages (`core`, `strategy`, `adapters/lmu`, `adapters/sim-replay`, `voice`, `ai`,
`input`, `persistence`) and `apps/desktop`; root scripts (`dev/build/test/lint/typecheck`).
Verify: `pnpm install && pnpm typecheck && pnpm lint && pnpm test` all pass on empty packages.
Context: [12-DEV-SETUP](12-DEV-SETUP.md), [01-ARCHITECTURE](01-ARCHITECTURE.md).

**T0.3 — `core`: canonical schema + validators + fixtures** · _Claude Code_ · deps: T0.2
Build: all types from [04-DATA-MODEL](04-DATA-MODEL.md) (`RaceState`, `PlayerCar`,
`CarState`, events, `FuelPlan`, `StintPlan`…); runtime validators (zod or similar);
hand-written fixture `RaceState`s (start of race, mid-stint, low fuel, multi-class traffic).
Verify: unit tests validate fixtures against schema; type-level tests compile.
Context: [04-DATA-MODEL](04-DATA-MODEL.md).

**T0.4 — `sim-replay` adapter + synthetic generator** · _Claude Code_ · deps: T0.3
Build: `GameAdapter` interface in `core`; a `sim-replay` adapter that (a) replays a recorded
frame file and (b) **synthesizes** plausible frames (configurable: fuel burn, lap times,
N rivals across classes, a scripted overtake + a fuel-low arc). This is the linchpin for
offline development.
Verify: replaying a fixture emits a deterministic frame stream; synthetic mode produces a
schema-valid `RaceState` sequence; snapshot tests on a scripted scenario.
Context: [03-LMU-INTEGRATION](03-LMU-INTEGRATION.md) §Validation harness, [04-DATA-MODEL](04-DATA-MODEL.md).

**T0.5 — Pipeline harness + Normalizer skeleton + `inspect` CLI** · _Claude Code_ · deps: T0.4
Build: the tick pipeline (`Adapter → Normalizer → RaceState stream`) with torn-read guard
hook; Normalizer skeleton (synthetic frames already near-canonical); a CLI
(`pnpm inspect <replay|synthetic>`) that prints `RaceState` at N Hz.
Verify: CLI prints evolving state from synthetic source; rolling fuel-per-lap appears;
unit tests on Normalizer conversions (units, wheel order).
Context: [01-ARCHITECTURE](01-ARCHITECTURE.md) §Data flow, [04-DATA-MODEL](04-DATA-MODEL.md).

**T0.6 — CI** · _Claude Code_ · deps: T0.2
Build: CI workflow running typecheck/lint/test on push/PR.
Verify: CI green on the current tree.
Context: [12-DEV-SETUP](12-DEV-SETUP.md).

**T0.7 — OSS release hygiene** · _Claude Code (+ human for license/signing choice)_ · deps: T0.1
Build: choose & add LICENSE (MIT/Apache-2.0); `THIRD-PARTY`/`NOTICE` scaffold; affiliation
disclaimer; `.gitignore` for `.env*`/models/build; CI secret-scanning; single-instance lock stub.
Verify: no key is committable; LICENSE + NOTICE present; secret-scan active.
Context: [16-PLATFORM-PREREQUISITES](16-PLATFORM-PREREQUISITES.md), [11-RISKS-AND-COMPLIANCE](11-RISKS-AND-COMPLIANCE.md).

> After M0, the team can build strategy, events, AI, and UI **entirely offline**.

---

## M1 — Integration spikes (Windows + LMU) · **[human-assisted]**

Run on the Windows rig with LMU. Goal: prove the assumptions in
[03-LMU-INTEGRATION](03-LMU-INTEGRATION.md) and **produce a real recording** to replace
synthetic fixtures. Write every finding back into doc 03's open-questions list.

**T1.1 — S1: raw shared-memory dump** · _human-assisted_ · deps: T0.2
Build: standalone koffi script: `OpenFileMapping`/`MapViewOfFile` on the rF2 SMMP buffers,
torn-read guard, dump key telemetry/scoring fields. _Human:_ install the plugin into LMU,
run a session.
Verify: live fuel/tire/position values print and match the in-game HUD.
Output: confirm install path, enable flags, populated fields → doc 03.

**T1.2 — S2: REST API probe** · _human-assisted_ · deps: T0.2
Build: probe `localhost` (≈`:6397`), enumerate endpoints, capture sample payloads.
Verify: standings/session/setup data retrieved; note which fields beat shared memory.
Output: endpoint list + schemas + read-only confirmation → doc 03.

**T1.3 — S3: current-aid readability** · _human-assisted_ · deps: T1.1
Verify: determine whether current TC/ABS/brake-bias/engine-map are readable (telemetry/
extended buffer or setup file). (Read-only — we never write them.)
Output: source + field locations → doc 03.

**T1.4 — S4: setup file read** · _human-assisted_ · deps: T1.1
Build: locate the setup directory; parse a setup file (read-only) into `SetupParams`.
Verify: parsed values match the in-game garage. Never write.
Output: location + format notes → doc 03.

**T1.5 — Record a real session** · _human-assisted_ · deps: T1.1 → **tooling ready (T2.4)**
Build: dump a full short stint to a replay file; commit a trimmed version as a test fixture.
The recorder now exists — on the rig run `pnpm record [--frames N] [--hz H] [--out file]`
(Adapter → Normalizer → Recorder → canonical-`RaceState` JSONL).
Verify: `pnpm replay <file>` runs it through the M0 pipeline. _Human:_ capture on the rig + commit a trimmed fixture.

---

## M2 — Real LMU adapter + Normalizer (real fields)

**T2.1 — `adapters/lmu` SharedMemoryReader** · _Claude Code (verify human-assisted)_ · deps: T1.1, T0.5 · **done**
Build: `LmuAdapter implements GameAdapter<LmuRawFrame>` — wraps the S1 torn-read-guarded reader
+ struct decoders, polls at a configurable Hz, `capabilities()`. Reader/clock injectable →
unit-tested off-Windows with a fake (5 tests). Read-only (FILE_MAP_READ only; no write/control
buffer).
Verify: ✅ off-Windows unit tests (capabilities, poll→emit, skip-when-no-scoring, stop/close).
_Human:_ run against a live session on the rig to confirm the wrapper end-to-end.

**T2.2 — REST client (read-only, cached)** · _Claude Code_ · deps: T1.2 (desk-researched; live pending), T2.1 · **done (transport; mapping pending live payloads)**
Build: `LmuRestClient` — **GET-only** read-only client (writes structurally impossible: hard-coded
GET + frozen endpoint allow-list, per docs/03 §S2). Base `http://localhost:6397` with IPv4→IPv6
fallback, feature-detection, TTL cache, throttled re-probe + shared in-flight detect; localhost
only. Endpoints: sessions / getAllVehicles / weather / strategy/usage (Virtual Energy) /
garage / RepairAndRefuel. Returns raw payloads.
Verify: ✅ mocked-fetch tests (detect, IPv6 fallback, cache+expiry, graceful-absent, throttle,
GET-only). **Pending live (Task B):** capture real payloads (Swagger) → map Virtual Energy +
pit/refuel into `RaceState` in the Normalizer; live connectivity check on the rig.

**T2.3 — Normalizer: real fields → `RaceState`** · _Claude Code_ · deps: T2.1 · **done (SHM; REST merge with T2.2)**
Build: `createLmuNormalizer()` maps `LmuRawFrame` → canonical `RaceState` — units (K→°C), wheel
order [FL,FR,RL,RR], class strings (`Hyper`/`LMP2`/`GT3` → className + lowercased classId), gaps
relative to player, stateful closing-rate + rolling fuel-per-lap, gamePhase/yellow → flags,
lap-time sentinels → null. The single rF2→canonical crossing point.
Unmapped-in-SHM (null/0 placeholders, filled by T2.2/decoder follow-ups): aids.tc/abs,
engine.map, inputs, worldPos, car.name, sectorYellows; brake-bias front/rear flagged (docs/03).
Verify: ✅ unit tests assert the mapping + **schema-validate the output** (`RaceStateSchema`);
multi-class grid mirroring the live rig capture (6 tests).

**T2.4 — Recorder (`pnpm record`)** · _Claude Code_ · deps: T2.1 · **done**
Build: game-agnostic `Recorder` (sim-replay) captures the canonical `RaceState` stream and
saves the JSON-Lines replay format (`maxFrames` cap, `truncated` flag — no silent loss);
`pnpm record` CLI (`tools/record.ts`) wires LmuAdapter → Normalizer → Recorder, fail-fast if
LMU isn't running. Reuses `serializeReplay`, so output replays via `pnpm replay`.
Verify: ✅ record → serialize/save → `parseReplay`/`readReplayFile` round-trips identically +
cap/truncation (3 tests). _Human:_ live capture on the rig.

---

## M3 — Strategy (fuel first) + events + persistence

**T3.1 — Fuel model** · _Claude Code_ · deps: T0.3 (works on synthetic data) → refine after T2.3
Build: robust per-lap consumption, laps-remaining, to-finish, save target, `confidence01`
([05-STRATEGY-ENGINE](05-STRATEGY-ENGINE.md) §1).
Verify: unit tests using the doc-05 worked examples; property tests (monotonicity, no NaN).

**T3.2 — Event detector core + framework** · _Claude Code_ · deps: T0.5
Build: debounce/cooldown/dedupe framework; `lap_completed`, `fuel_low` events with tiers.
Verify: synthetic fuel-low arc fires exactly one event with correct cooldown; tests.

**T3.3 — Persistence (SQLite) + learning priors** · _Claude Code_ · deps: T3.1
Build: better-sqlite3 repos; `sessions`/`laps`/`fuel_models`; prior blend feeds `confidence`.
Verify: write/read round-trip; priors shift estimates as samples accumulate (tests).

**T3.4 — Spotter geometry** · _Claude Code_ · deps: T2.3 (or synthetic positions)
Build: `car_left`/`car_right`/`three_wide`/`clear` events from world positions + closing rate
(events only; audio in M4).
Verify: synthetic side-by-side scenario produces correct, debounced events.

---

## M4 — Voice & input (the radio plumbing)

**T4.1 — Input reader + PTT mapping** · _Claude Code (mapping verify human-assisted)_ · deps: T0.2
Build: SDL2 (koffi/addon) device enumeration; passive (read-only) button edges; press-to-map
flow; app-side quick actions. _Human:_ map a real wheel button.
Verify: logic/debounce unit tests with a mock device; live mapping (human).
Context: [08-INPUT-AND-CONTROLS](08-INPUT-AND-CONTROLS.md) §1.

**T4.2 — TTS + audio playback + priority queue + Tier-0 pre-render** · _Claude Code_ · deps: T0.2
Build: `TtsProvider` iface + one cloud provider (streaming); `VoicePlayer` priority queue
(preempt/duck/barge-in); pre-render the fixed spotter phrase set.
Verify: queue tests (urgent preempts chatter; barge-in stops playback); a spoken sample
plays. _Human:_ provide a TTS API key; confirm audio.
Context: [07-VOICE-IO](07-VOICE-IO.md).

**T4.3 — STT + PTT capture** · _Claude Code_ · deps: T4.1, T4.2
Build: `SttProvider` iface + one cloud provider (streaming); capture mic while PTT held →
final transcript.
Verify: a held-button utterance transcribes. _Human:_ STT key + mic.
Context: [07-VOICE-IO](07-VOICE-IO.md).

**T4.4 — Local fallback interfaces (stubs)** · _Claude Code_ · deps: T4.2, T4.3
Build: Piper/whisper.cpp provider shells behind the same ifaces (impl can be deferred to M10).
Verify: interface conformance tests; provider-swap is config-only.

**T4.5 — Microphone permission + audio I/O** · _Claude Code (live verify human-assisted)_ · deps: T4.3
Build: `getUserMedia` capture; handle OS-denied mic (deep-link `ms-settings:privacy-microphone`);
output-device enumeration/selection; hot-plug + default-change handling; text-input fallback.
Verify: denied-mic path shows guidance (no crash); voice routes to the chosen output device.
Context: [16-PLATFORM-PREREQUISITES](16-PLATFORM-PREREQUISITES.md) §1.

**T4.6 — Local-model manager** · _Claude Code_ · deps: T0.2 (underpins T4.2/T4.3 and the free LLM route)
Build: first-run download + checksum + version-pin into user-data dir; GPU/CUDA + VRAM detection
to choose CPU vs GPU and recommend the LLM route; Ollama detect/guide; offline-bundle option.
Verify: cold start downloads + verifies models; CPU fallback works with no GPU stack.
Context: [16-PLATFORM-PREREQUISITES](16-PLATFORM-PREREQUISITES.md) §2.

---

## M5 — AI Engineer + MVP vertical slice ("it talks")

**T5.1 — AI orchestration + read-only tools** · _Claude Code_ · deps: T3.1, T3.4
Build: Claude client (`@anthropic-ai/sdk`), system prompt + persona (cached), **read-only**
tool defs (`get_race_state`, `get_fuel_plan`, `get_rivals`, `get_tire_status`,
`get_current_aids`…) wired to strategy/race-state; streaming.
Verify: tool-call tests with fixture `RaceState`; model quotes tool numbers (no invented
figures). _Human:_ Claude API key.
Context: [06-AI-ENGINEER](06-AI-ENGINEER.md).

**T5.2 — Reactive radio loop end-to-end** · _Claude Code (live verify human-assisted)_ · deps: T5.1, T4.3
Build: PTT → STT → Claude(tools) → streaming TTS; "how's my fuel / last lap / who's behind me".
Verify: scripted-transcript tests (no mic) give correct spoken answers from fixtures; live
push-to-talk works (human).

**T5.3 — Hallucination guard + latency harness** · _Claude Code_ · deps: T5.2
Build: automated check that every spoken number came from a tool result that turn; end-to-end
latency timing per tier.
Verify: guard fails a planted hallucination; Tier-2 first-audio measured.

**T5.4 — Proactive fuel-low call-out + Tier-0 spotter audio** · _Claude Code_ · deps: T3.2, T3.4, T4.2
Build: route `fuel_low` (LLM-phrased) and `car_left/right` (pre-rendered) to the voice queue.
Verify: synthetic arcs trigger the right audio at the right tier/latency.

> **🚦 MVP GATE** = [10-ROADMAP](10-ROADMAP.md) Phase 1 acceptance: live LMU, three voice
> questions answered correctly < ~2 s, spotter < 300 ms, fuel-to-finish spoken, full short
> race without crashing.

---

## M6 — Desktop shell & dashboard

**T6.1 — Electron shell + worker-hosted Engineer Core + typed IPC** · _Claude Code_ · deps: T0.5
Build: Electron main/preload/renderer; run the tick pipeline in a worker/utility process;
throttled `RaceState` snapshots over typed IPC (~10–15 Hz).
Verify: app boots; renderer shows live values from a synthetic source.

**T6.2 — Live dashboard** · _Claude Code_ · deps: T6.1
Build: fuel / 4-corner tires / brakes / aids / position+gaps(+class) / timing widgets
(Tailwind+shadcn), color/state-honesty rules.
Verify: renders from fixtures; redraw throttled; visual tests (Playwright) on fixture state.
Context: [09-UI-UX](09-UI-UX.md).

**T6.3 — Settings + secrets** · _Claude Code_ · deps: T6.1, T4.x, T5.1
Build: voice/mode pick, PTT mapping UI, API keys via Electron `safeStorage`, proactivity level.
Verify: keys persist securely (never logged); mapping round-trips; mode switch takes effect.

**T6.4 — Overlay window** · _Claude Code_ · deps: T6.2
Build: always-on-top transparent click-through overlay with a minimal widget set.
Verify: overlay renders over a borderless window (human); off by default.

---

## M7 — Endurance strategy depth (Roadmap Phase 2)

Order within: T7.1 tire-deg model → T7.2 pit-loss model → T7.3 stint planner → T7.4
undercut/overcut → T7.5 multi-class traffic forecasting → T7.6 FCY/SC opportunism → T7.7
learning layer (priors per car/track/conditions) → T7.8 strategy UI + rival tracker → T7.9
proactive strategy call-outs. Each pure-math task is unit-tested with doc-05 examples and
validated on recorded endurance sessions (replay eval set).
Gate: Phase 2 acceptance (fuel-to-finish ±1 lap by mid-stint; pit calls match labeled set;
multi-class warnings precede encounters).
Context: [05-STRATEGY-ENGINE](05-STRATEGY-ENGINE.md).

## M8 — Proactive coaching & in-race aid advice (Roadmap Phase 3)

T8.1 read current aids → T8.2 background-strategist loop → T8.3 integrated coaching
(aid/driving ⇄ tire/fuel ⇄ strategy) → T8.4 advice verification from telemetry → T8.5
proactivity controls + quiet windows. **Read-only throughout — no write path.**
Context: [06-AI-ENGINEER](06-AI-ENGINEER.md), [08-INPUT-AND-CONTROLS](08-INPUT-AND-CONTROLS.md).

## M9 — Setup advisory (Roadmap Phase 4)

T9.1 read setup (read-only) → T9.2 handling diagnosis from telemetry → T9.3 setup screen
(current values + safe ranges) → T9.4 AI recommendations (`propose_setup_change`, advice
only) → T9.5 before/after compare after the driver applies changes in the garage.
Context: [08-INPUT-AND-CONTROLS](08-INPUT-AND-CONTROLS.md) §3, [09-UI-UX](09-UI-UX.md).

## M10 — Polish, local mode, packaging (Roadmap Phase 5)

T10.1 wire local STT/TTS (Piper/Kokoro + faster-whisper) + cost estimator → T10.2 full
onboarding (profile choice + model download/GPU detect + mic permission + plugin-install
helper + health UI, per [16](16-PLATFORM-PREREQUISITES.md) §5) → T10.3 crash isolation,
graceful degradation, local diagnostics export → T10.4 eval suites (latency + accuracy) in
CI on recordings → T10.5 electron-builder installer + auto-update (GitHub Releases) + **code
signing (SignPath Foundation, free for OSS)** + `THIRD-PARTY`/`NOTICE`.
Gate: clean install on a fresh Windows PC; guided first-run to a working radio exchange;
multi-hour race unattended; documented cloud cost/hour + working free local mode.

---

## Human-in-the-loop checklist (only the user can do these)

- [ ] Install the rF2 Shared Memory Map plugin into LMU; run sessions for spikes (M1).
- [ ] (Premium/BYO-key profile only) Provide & store API keys: Claude / STT / TTS. The free profile needs none.
- [ ] (Local-LLM route only) Install Ollama; the free cloud-tier and template routes don't need it.
- [ ] Map a physical wheel button for PTT; confirm mic + audio output (T4.x).
- [ ] Record real sessions to replace synthetic fixtures (T1.5, T2.4).
- [ ] Validate live behavior at the MVP gate and each phase gate.
- [ ] Confirm overlay over the chosen display mode (T6.4).
- [ ] Choose the OSS license; set up SignPath Foundation code signing in CI (T0.7, T10.5).

## Suggested first three sessions

1. **T0.1 + T0.2** — repo + monorepo scaffold green.
2. **T0.3** — canonical schema + fixtures.
3. **T0.4 + T0.5** — replay/synthetic adapter + `inspect` CLI printing live synthetic
   `RaceState`. *At this point you can demo a moving race state with no game installed* —
   and every subsequent logic task is testable offline.

In parallel, whenever you're next at the Windows rig with LMU, start **T1.1** (raw
shared-memory dump) to begin de-risking the integration.
