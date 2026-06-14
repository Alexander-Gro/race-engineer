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
  `fuel_models` via better-sqlite3 + learning-priors layer that seeds the fuel model),
  T3.4 (spotter geometry: `car_left`/`car_right`/`three_wide`/`clear` events from
  lateral + along-track overlap; assumes +right lateralPos sign — see docs/04, confirm in T2.3),
  T5.1 (AI orchestration + read-only tools — **built provider-agnostic & local-first**:
  `LlmProvider` interface, 5 read-only tools wired to RaceState/fuel model, tool-loop
  orchestrator, system prompt/persona, a deterministic `FakeProvider`, and a real key-less
  **`OllamaProvider`**. No key needed to pass tests),
  T4.1 (input reader + PTT mapping — backend-agnostic edge/debounce/binding/press-to-map
  logic, mock-device tested; Windows-only `Sdl2Backend` scaffold via koffi, live-mapping
  half flagged for the rig),
  T4.2 (TTS + audio playback — `TtsProvider`/`AudioSink` interfaces, a preemptible
  `VoicePlayer` priority queue (urgent spotter preempts, barge-in, FIFO-by-priority), Tier-0
  pre-render, `FakeTtsProvider` + `MockAudioSink`; real cloud/local TTS + OS sink are the
  live half),
  T4.3 (STT + PTT capture — `SttProvider`/`SttStream`/`MicSource` interfaces + `RadioCapture`
  (PTT begin/end → partials + final transcript), `FakeSttProvider` + `MockMicSource`; real
  cloud/local STT + the OS mic are the live half),
  **M2 LMU adapter (offline halves)** — T2.1 (`LmuAdapter` behind `GameAdapter`), T2.3
  (`LmuNormalizer`: raw rF2 → canonical `RaceState`, class strings `Hyper`/`LMP2`/`GT3` from
  the live rig capture), T2.4 (`Recorder` + `pnpm record`), T2.2 (read-only GET-only
  `LmuRestClient`). All four merged to `main` (177 tests green together),
  T5.2 (reactive radio loop end-to-end — new **`@race-engineer/radio`** package: `ReactiveRadioLoop`
  wires PTT→STT→AI(read-only tools)→sentence-streamed TTS, plus a `speak()` bridge in `voice` that
  turns a reply into per-sentence clips on the `VoicePlayer` queue at CHATTER priority. Barge-in on
  PTT, rolling dialogue history, and a supersede guard so a stale answer never talks over a re-keyed
  question. Scripted-transcript tests answer "how's my fuel / last lap / who's behind me" from
  fixtures — including one driven through an `InputReader` mock-wheel PTT edge; live mic/STT/TTS + a
  mapped wheel button are the **human-assisted** half. 190 tests green),
  T5.3 (hallucination guard + latency harness — `checkSpokenNumbers` in `ai` traces every spoken
  number back to a tool result that turn (rounding-tolerant, sign-insensitive); a `radio` latency
  harness times the Tier-2 path against the docs/01 budgets via an injectable clock. The loop emits
  `onHallucinationCheck` + `onLatency` (detection-only). 208 tests green),
  T5.4 (proactive call-outs — `ProactiveVoiceRouter` in `radio` routes `EngineerEvent`s to the
  `VoicePlayer` by tier: Tier-0 reflex spotter → pre-rendered clip (preempts, no LLM/synth),
  `fuel_low` → `templatePhraser` (free default) or `llmPhraser` (BYO-provider) spoken at
  WARNING/STRATEGY; synthetic fuel + spotter arcs through the real `EventDetector` assert the right
  audio at the right tier. 221 tests green). **This completes the M5 logic vertical slice.**
  T6.1 (Electron shell + worker-hosted Engineer Core — new **`@race-engineer/engineer-core`**:
  `EngineerCore` drives the pipeline → throttled ~12 Hz `RaceState` snapshots over a typed,
  read-only Core→renderer IPC contract; `apps/desktop` gains the Electron shell scaffold
  (main/preload/utility-process worker/renderer). Core + throttle + worker wiring unit-tested
  offline against the synthetic source; the Electron **boot is the human-verify half**. 228 green),
  T4.4 (local provider shells in `voice` — `piperTts`/`kokoroTts`, `fasterWhisperStt`/`whisperCppStt`
  behind the existing TTS/STT ifaces with an injected native backend deferred to T10.1; a config-only
  `selectTts/SttProvider` selector + the free/local `DEFAULT_VOICE_PROFILE`; `available?` + a
  `ProviderNotReadyError` fallback seam. 236 green),
  T5.1b (cloud BYO-key LLM providers — `ClaudeProvider` on `@anthropic-ai/sdk` (default fast
  `claude-haiku-4-5`, docs/06 tiering) + `OpenAiCompatProvider` with Groq/Gemini/OpenRouter presets,
  both behind `LlmProvider`; key from OS secure storage, **never embedded**, no central server;
  mocked-transport conformance tests. 245 green),
  T4.6 (local-model manager — new **`@race-engineer/platform`**: `ModelManager` (download/copy →
  SHA-256 verify → version-pinned install; idempotent; offline-bundle; corrupt-file removal),
  `recommendRoute` (CPU-vs-GPU + LLM route from VRAM headroom beside the sim), and Ollama
  detect/guide/resolve — all pure over injectable ports; concrete Node/Windows impls are the runtime
  half. 263 green),
  T7.1 (tire-degradation model in `strategy` — `fitTireDegradation` (least-squares lap-time-vs-stint-lap
  fit, prior-blended, `confidence01`, silent when no signal) + `predictLapTimeS` + `degLossOverStintS`
  + `assessTireWindow(s)`; worked-example + property tests. **Opens M7.** 276 green),
  T7.2 (pit-stop time model in `strategy` `pit.ts` — `refuelTimeS` (fuelToAdd / rate), `serviceTimeS`
  (max of the parallel refuel ∥ tyres ∥ repair ops, + the dominating `bottleneck`), `computePitLoss`
  (`pitLaneTimeLoss + serviceTime` → `PitLoss`), and `estimatePitLaneTimeLossS` (derive the per-track
  transit penalty from one measured pit pass = transit − service − on-track-equivalent, clamped ≥0).
  Pure/deterministic, depends on `core` only; feeds the stint planner (T7.3 — one fewer stop saves one
  `totalPitLossS`, weighed vs `degLossOverStintS`). Worked-example (47 s / 30 s / 62 s stops) + property
  tests (refuel monotone in fuel; total ≥ pit-lane loss and ≥ service; no NaN/∞). 293 green),
  T7.3 (stint planner in `strategy` `stint.ts` — `planStints` composes the fuel (T3.1) + tyre-deg
  (T7.1) + pit-loss (T7.2) models into a schema-valid `StintPlan`: bounds max stint length by fuel
  (`maxStintLapsByFuel = floor((tank − reserve)/perLap)`) and tyre life, takes the fewest covering
  stints (≥ `mandatoryStops + 1`), and — **only when both a pit-loss and a confident deg rate are
  known** — `optimizeStintCount` checks whether extra stops save more deg than they cost (docs/05 §4
  "prefer fewer stops unless deg cost > pit-loss savings"), else prefers fewer stops; `distributeLaps`
  balances laps across stints. Emits stint boundaries, recommended fuel loads, `expectedDegradation01`,
  and per-stop `[earliest, latest]` pit windows. Worked-example (fuel-bound 2×15, tyre-bound 4×10,
  trade-off → 3 stints, mandatory-stop) + property (more tank ⇒ not more stints; contiguous/cover-exact;
  schema-valid; no NaN/∞) tests. 312 green),
  T7.4 (undercut/overcut in `strategy` `undercut.ts` — `evaluateUndercut` returns the docs/05 §5 tool
  shape `{ recommend: 'now'|'later'|'hold', deltaS, undercutGainS, rationale, confidence01 }`:
  `undercutGainS = laps·freshTyreGain − outLapLoss − (pitLossSelf − pitLossRival)` (made
  dimensionally concrete — fresh-tyre advantage adds, out-lap/pit-delta subtract; docs/05 §5 updated
  to match), then **now** if the swing clears the gap (chase passes / defend covers), **later** if
  pitting now is a net loss (tyres too fresh), **hold** within margin. Pure/deterministic, depends on
  `core` only; inputs come from the tyre (T7.1) + pit-loss (T7.2) models. Worked-example (chase→now,
  too-fresh→later, gap-too-big→hold, slow-pit flips→later, defend cover/hold) + property (gain monotone
  in fresh-tyre advantage; bigger gap ⇒ smaller clearance; confidence∈[0,1]; no NaN/∞) tests. 324 green).
- **Next up — Track A:** continue **M7** offline strategy depth (the main remaining pure-logic body):
  **T7.5** (multi-class traffic forecasting: faster-class-approaching / slower-class-ahead warnings +
  lap-time contamination, docs/05 §6 — the LMU differentiator), then **T7.6** (FCY/SC opportunism,
  docs/05 §7). The **GUI/runtime** tasks (**T6.2** dashboard, **T4.5** mic/audio)
  need a machine with a screen + the Electron renderer toolchain. The 🚦 MVP gate needs the **live
  half** (Track B) + working voice I/O (T10.1 or cloud STT/TTS).
- **Track B (needs the Windows rig + LMU):** **T1.5** — `pnpm record` a real stint → commit a
  trimmed fixture (recorder ready). **T2.2 live** — REST probe (Task B) → finish REST→`RaceState`
  mapping + settle S3 aids. **T1.3/T1.4** aids/setup reads. Confirm the spotter `lateralPos`
  sign + brake-bias front/rear against the HUD (docs/03).

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

**T4.1 — Input reader + PTT mapping** · _Claude Code (mapping verify human-assisted)_ · deps: T0.2 · **done (offline half)**
Build: backend-agnostic `InputBackend` + `EdgeDetector` (lockout debounce), `BindingSet` +
`ButtonCapture` (press-to-map), `InputReader` (PTT down/up + quick actions on press, own poll
loop off the hot path), `MockBackend`. Windows-only `Sdl2Backend` (koffi, passive/non-exclusive
joystick read) is a **scaffold** — loads `SDL2.dll` lazily, so it typechecks on macOS but is
not run there.
Verify: ✅ logic/debounce unit tests with a mock device (17 tests).
_Human (Windows rig):_ install/bundle `SDL2.dll`; map a real wheel button live; complete the
`Sdl2Backend` `TODO(rig)` items — stable device GUID (`SDL_JoystickGetGUIDString`) and hot-plug
re-enumeration — and confirm passive reads don't disturb the game's own input.
Context: [08-INPUT-AND-CONTROLS](08-INPUT-AND-CONTROLS.md) §1.

**T4.2 — TTS + audio playback + priority queue + Tier-0 pre-render** · _Claude Code_ · deps: T0.2 · **done (offline half)**
Build: `TtsProvider` + `AudioSink` interfaces; `VoicePlayer` priority queue — urgent (≥WARNING)
**preempts**, lower priorities **queue** in priority order, **barge-in** stops + clears on PTT;
`prerenderTier0` for the fixed spotter/position phrase set; `FakeTtsProvider` + `MockAudioSink`
for tests. Concrete streaming TTS providers (cloud BYO-key; local Piper/Kokoro) and the OS audio
sink are the live half (T4.4 / T10.1 / runtime); per docs/15 the default stays free/local.
Verify: ✅ queue tests (urgent preempts chatter; barge-in stops playback; priority order) +
pre-render integrity (11 tests).
_Human:_ provide a TTS key (premium) or run local TTS; confirm a spoken sample plays on the device.
Context: [07-VOICE-IO](07-VOICE-IO.md), [15-COST-AND-FREE-OPERATION](15-COST-AND-FREE-OPERATION.md).

**T4.3 — STT + PTT capture** · _Claude Code_ · deps: T4.1, T4.2 · **done (offline half)**
Build: `SttProvider` + `SttStream` + `MicSource` interfaces; `RadioCapture` — PTT `begin` opens
a stream and feeds mic audio, `end` finalizes → transcript (with streaming partials), `cancel`
aborts; capture only runs while held (gated). `FakeSttProvider` + `MockMicSource` for tests.
Real streaming STT (cloud BYO-key Deepgram/OpenAI; local faster-whisper) and the OS mic are the
live half; per docs/15 the default stays free/local.
Verify: ✅ a held-button utterance transcribes; partials stream; gating + cancel (5 tests).
_Human:_ STT key (premium) or local STT; a real mic; confirm a held-button utterance transcribes.
Context: [07-VOICE-IO](07-VOICE-IO.md), [15-COST-AND-FREE-OPERATION](15-COST-AND-FREE-OPERATION.md).

**T4.4 — Local fallback interfaces (stubs)** · _Claude Code_ · deps: T4.2, T4.3 · **done**
Build: local provider shells in `voice` behind the existing `TtsProvider`/`SttProvider` ifaces —
`LocalTtsProvider` (`piperTts`/`kokoroTts`), `LocalSttProvider` (`fasterWhisperStt`/`whisperCppStt`).
The native binding (binary + model) is an **injected backend deferred to T10.1**: without it the
shell reports `available:false` and throws `ProviderNotReadyError` (so a profile falls back, never
crashes mid-race — docs/15 §free routes); with it (T10.1, or a fake in tests) it delegates. A
config-only selector (`selectTtsProvider`/`selectSttProvider` + `VoiceProviderConfig`) and
`DEFAULT_VOICE_PROFILE` = the docs/15 **free/local** default (`kokoro` + `faster-whisper`, no key).
Added optional `available?` to the provider interfaces (additive). **Read-only — voice I/O only.**
Verify: ✅ interface-conformance tests (shape + not-ready throw + injected-backend delegation);
provider-swap is config-only (swap one field → different provider, no code change); default profile
is free/local (8 tests; 236 green). Native impl + live audio: T10.1.

**T4.5 — Microphone permission + audio I/O** · _Claude Code (live verify human-assisted)_ · deps: T4.3
Build: `getUserMedia` capture; handle OS-denied mic (deep-link `ms-settings:privacy-microphone`);
output-device enumeration/selection; hot-plug + default-change handling; text-input fallback.
Verify: denied-mic path shows guidance (no crash); voice routes to the chosen output device.
Context: [16-PLATFORM-PREREQUISITES](16-PLATFORM-PREREQUISITES.md) §1.

**T4.6 — Local-model manager** · _Claude Code (live impls human/T10.1)_ · deps: T0.2 (underpins T4.2/T4.3 and the free LLM route) · **done (logic)**
Build: new `@race-engineer/platform` package — `ModelManager` does first-run **download** (or
offline-bundle **copy**) → **SHA-256 verify** → **version-pinned** install (`<modelsDir>/<id>/
<version>/<file>`) into the user-data dir; idempotent; a corrupt download is removed, not left
half-written (`ModelChecksumError`). `recommendRoute` picks CPU vs GPU for voice and the LLM route
from a `GpuInfo` snapshot — local LLM **only with VRAM headroom beside the sim** (docs/15 §contention),
else the free cloud tier (template mode the universal offline fallback). `detectOllama` (injected
HTTP, never throws) + `ollamaInstallGuide` + `resolveLlmRoute` bridge GPU + Ollama → final route/guide.
All **pure over injectable ports** (download/hash/fs/GPU/HTTP); the concrete Node/Windows impls are
the runtime half. **Read-only — writes only model files to user-data, nothing to the game.**
Verify: ✅ cold start downloads → verifies → returns the pinned path; idempotent (no re-download);
checksum mismatch removes the file + throws; offline-bundle copies (no network); **CPU-fallback route
with no GPU stack**; Ollama detect/resolve table (18 tests; 263 green). Real model specs (URLs/SHA-256)
+ native download/GPU-probe wiring land with the bundles in T10.1.
Context: [16-PLATFORM-PREREQUISITES](16-PLATFORM-PREREQUISITES.md) §2.

---

## M5 — AI Engineer + MVP vertical slice ("it talks")

**T5.1 — AI orchestration + read-only tools** · _Claude Code_ · deps: T3.1, T3.4 · **done**
Build: provider-agnostic `LlmProvider` interface, system prompt + persona (cache-friendly),
**read-only** tool defs (`get_race_state`, `get_fuel_plan`, `get_rivals`, `get_tire_status`,
`get_current_aids`) wired to strategy/race-state, and a tool-loop orchestrator (`runRadioTurn`).
**Built local-first** (per the free-default architecture, docs/06 §swappable / docs/15): a
deterministic `FakeProvider` (tests) and a real key-less `OllamaProvider` (Route B). The other
docs/06 tools (`get_stint_plan`, `project_pit_window`, `evaluate_undercut`, `get_setup_summary`,
`get_handling_diagnosis`, `verify_change`) ship with the strategy/setup features that back them
(M7/M9). Streaming is deferred to the live loop (T5.2/T5.3).
Verify: ✅ tool-call tests with fixture `RaceState`; orchestrator quotes tool numbers verbatim
(no invented figures); Ollama request/response mapping unit-tested with an injected `fetch`.
_Human (local-LLM route):_ install Ollama + `ollama pull qwen3`, run `ollama serve`.
Context: [06-AI-ENGINEER](06-AI-ENGINEER.md), [15-COST-AND-FREE-OPERATION](15-COST-AND-FREE-OPERATION.md).

**T5.1b — Cloud LLM providers behind `LlmProvider` (opt-in, BYO-key)** · _Claude Code (live smoke human-assisted)_ · deps: T5.1 · **done**
Build: `ClaudeProvider` on `@anthropic-ai/sdk` (Messages API + tool use; injectable client) and
`OpenAiCompatProvider` (Groq/Gemini/OpenRouter via the injectable `FetchLike`, `groqProvider`/
`openRouterProvider`/`geminiProvider` presets), both behind the existing `LlmProvider` + read-only
tool surface. Maps the neutral `ChatMessage`/`ToolSpec` ↔ each wire format (tool_use/tool_result vs
tool_calls), preserving tool-call ids. Default Claude model = **fast `claude-haiku-4-5`** (docs/06
§Model tiering — overridable to `claude-opus-4-8` for deliberative). **Key from OS secure storage,
never embedded; no central server — each provider calls the vendor directly with the user's own key
(docs/15).** Streaming deferred (the `LlmProvider` contract is non-streaming, as for Ollama).
Verify: ✅ provider-conformance tests with **mocked transport** (Claude via a fake SDK client,
OpenAI-compat via a fake `fetch`): request mapping, tool_use/tool_call response mapping, multi-turn
tool-result mapping, `Bearer` auth uses the injected key (no embedded key), full `runRadioTurn`
tool→answer (9 tests; 245 green). _Human:_ a live smoke test with a real provider key.
Context: [06-AI-ENGINEER](06-AI-ENGINEER.md), [15-COST-AND-FREE-OPERATION](15-COST-AND-FREE-OPERATION.md).

**T5.2 — Reactive radio loop end-to-end** · _Claude Code (live verify human-assisted)_ · deps: T5.1, T4.3 · **done (offline half)**
Build: new `@race-engineer/radio` package — `ReactiveRadioLoop` wires PTT → STT(`RadioCapture`) →
AI(`runRadioTurn`, read-only tools) → sentence-streamed TTS; a `speak()` bridge in `voice` splits a
reply into per-sentence clips on the `VoicePlayer` queue (CHATTER). Provider-agnostic and key-less
by default; barge-in on PTT, rolling dialogue history, supersede guard. **Read-only/advisory — no
path to the game.**
Verify: ✅ scripted-transcript tests (no mic) answer "how's my fuel / last lap / who's behind me"
from fixtures (spoken number == the tool's number), an `InputReader` mock-wheel PTT edge drives it
end-to-end, plus barge-in / empty-transcript / history / supersede tests (13 tests).
_Human:_ real mic + STT/TTS and a mapped wheel button — confirm live push-to-talk works on the rig.

**T5.3 — Hallucination guard + latency harness** · _Claude Code_ · deps: T5.2 · **done**
Build: `checkSpokenNumbers` in `ai` — a pure, provider-agnostic guard that traces every digit-form
number the model **spoke** back to a tool result that turn (rounding-tolerant + sign-insensitive,
walks nested JSON); reports the ungrounded figures. A latency harness in `radio` — per-tier
first-audio budgets (`LATENCY_BUDGET_MS`, reusing core `Tier`), `TurnLatency`, `withinBudget`, and a
`LatencyAggregator` (min/mean/max/p95 vs budget). The loop is instrumented with an injectable clock:
it times the Tier-2 path (transcript→reply→first-audio via a `speak()` `onFirstClip` hook) and emits
`onLatency` + `onHallucinationCheck` — **detection/observability only, no write path.**
Verify: ✅ guard fails a planted hallucination (direct + over a real `runRadioTurn` result) and
passes a verbatim quote; Tier-2 first-audio measured with an injected clock; aggregator/budget unit
tests (18 tests; 208 green). Runtime enforcement *policy* (suppress vs. log on `grounded:false`) is
a later concern — this wires the check + emit-only callback.

**T5.4 — Proactive fuel-low call-out + Tier-0 spotter audio** · _Claude Code_ · deps: T3.2, T3.4, T4.2 · **done**
Build: `ProactiveVoiceRouter` in `radio` routes `EngineerEvent`s to the `VoicePlayer` by tier —
Tier-0 reflex (`car_left/right`/`three_wide`/`clear`) → the **pre-rendered** clip (SPOTTER priority,
preempts; **no LLM, no live synth**), `fuel_low` → a short phrase via `templatePhraser` (free/offline
default, docs/15) or `llmPhraser` (BYO-provider, tools-free, quotes the payload number) spoken with
sentence-streamed TTS at WARNING/STRATEGY. `routeAll` enqueues reflex calls first so a spotter call
never waits behind a phrased synth. **Read-only/advisory — audio only.**
Verify: ✅ a declining-fuel synthetic arc (real `EventDetector` + `fuelLowRule`) fires `fuel_low` and
routes it to spoken audio at escalating priority (STRATEGY→WARNING); a car drawing alongside
(`spotterRule` over the multi-class fixture) routes to the pre-rendered `car_right` clip with **zero**
TTS synth calls; reflex preempts chatter, `clear` queues (11 tests; 221 green).

> **🚦 MVP GATE** = [10-ROADMAP](10-ROADMAP.md) Phase 1 acceptance: live LMU, three voice
> questions answered correctly < ~2 s, spotter < 300 ms, fuel-to-finish spoken, full short
> race without crashing.

---

## M6 — Desktop shell & dashboard

**T6.1 — Electron shell + worker-hosted Engineer Core + typed IPC** · _Claude Code (boot verify human-assisted)_ · deps: T0.5 · **done (offline half)**
Build: new `@race-engineer/engineer-core` package — `EngineerCore` drives the tick pipeline
(Adapter → Normalizer → `RaceState`) and pushes **throttled** snapshots (~12 Hz, `Throttle` on the
frame's `monotonicMs`, final-state flush) through an injected `SnapshotTransport`; a typed IPC
contract (`EngineerSnapshot`, `SNAPSHOT_CHANNEL`, read-only `EngineerBridge`). `apps/desktop`:
Electron-agnostic `createSyntheticEngineerCore` (the worker wiring), plus the Electron shell —
`main` (window + `utilityProcess` worker, contextIsolation/sandbox), `preload` (exposes the
**read-only** subscribe bridge), `engineer-worker` (`postMessage`s snapshots), and a minimal
`renderer` (paints live values via `textContent`). **Read-only/advisory — IPC is Core→renderer only.**
Verify: ✅ offline — `EngineerCore`/`Throttle` unit-tested driving the synthetic source (throttled
cadence, dense seq, schema-valid `RaceState`, final flush); `createSyntheticEngineerCore` ships
snapshots to a spy transport (7 tests; 228 green). _Human (dev machine):_ `pnpm add -D electron` +
a renderer bundler, then `dev:electron` → window streams ~12 Hz synthetic values (README §Running).

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

**T7.1 — Tire-degradation model** · _Claude Code_ · deps: T0.3 (works on synthetic/recorded laps) · **done**
Build: `@race-engineer/strategy` `tires.ts` — `fitTireDegradation` (least-squares fit of green
lap time vs lap-into-stint → `baseLapS + degRatePerLapS·stintLap`, blended with a `tire_models`
prior the same way the fuel model blends, `confidence01 = n/(n+priorWeight)`; silent when no
signal), `predictLapTimeS` (end-of-stint pace), `degLossOverStintS` (cumulative deg cost for
stint-length / double-stint comparison — feeds T7.3), and `assessTireWindow(s)` (temps vs target
window → cold/in-window/hot/mixed). Pure/deterministic, depends on `core` only.
Verify: ✅ worked linear-fit + noisy-fit + prior-blend + silent-case unit tests; property tests
(confidence monotonic in sample count ∈ [0,1]; steeper deg ⇒ slower late-stint pace; no NaN/∞)
(13 tests; 276 green). Replay-eval on recorded stints lands with T1.5/T7.7.

Remaining order: ~~T7.2 pit-loss model~~ (done) → ~~T7.3 stint planner~~ (done) → ~~T7.4
undercut/overcut~~ (done) → T7.5 multi-class traffic forecasting → T7.6 FCY/SC opportunism → T7.7
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
