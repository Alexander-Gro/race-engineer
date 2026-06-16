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
  in fresh-tyre advantage; bigger gap ⇒ smaller clearance; confidence∈[0,1]; no NaN/∞) tests. 324 green),
  T7.5 (multi-class traffic forecasting, docs/05 §6 — the LMU differentiator. Two pieces: (a) a
  predictive **event rule** in `core` `events/rules/traffic.ts` — `trafficForecast` + `trafficRule`
  emit Tier-1 `faster_class_approaching` (a different-class car closing from behind within a time
  horizon) and the new `slower_class_ahead` (a different-class car ahead you're catching) from
  `gapToPlayerS` (+behind/−ahead) and `closingRateMps` (assumed +=closing; flag for live-confirm),
  one call-out per car per cooldown via the detector, ETA in the payload — the *predictive* sibling
  the spotter (T3.4) deferred to; (b) **lap-time contamination** hygiene in `strategy` `traffic.ts` —
  `isStuckBehindTraffic` (per-tick dirty-air predicate) + `lapTrafficWeight` (1−fraction) +
  `cleanLapValues` (drop laps too contaminated to feed the median fuel model, docs/05 §6 last bullet).
  Added `slower_class_ahead` to the core `EventType` enum (additive). Fixture-driven (live-rig
  multi-class capture) + constructed-frame + cooldown + contamination tests. 340 green),
  T7.6 (FCY/SC opportunism, docs/05 §7. Two pieces: (a) a **core event rule** `events/rules/fcy.ts` —
  `fcyRule` edge-detects green→caution (`flags.global` = `fcy`/`safetyCar`) and emits one Tier-2
  `fcy_opportunity` trigger per caution (suppressed while already pitting), `isUnderCaution` helper;
  (b) **strategy decision** `strategy/fcy.ts` — `fcyPitLoss` (`cautionPitLoss ≈ greenPitLoss ·
  cautionPaceFraction`, `saved = green − caution`) + `evaluateFcyStop` → `box_now` when under caution
  AND the stop is meaningfully cheaper AND due soon (or a mandatory stop is outstanding), else
  `stay_out` (a cheap stop you don't need just buys a later one). Pure/deterministic; `greenPitLossS`
  from T7.2. Reconciled the docs/05 §7 `fci_opportunity` typo → `fcy_opportunity` (the schema name).
  Edge/sustain/re-arm/in-pit event tests + worked-example + property (saved∈[0,green] decreasing in
  caution pace; confidence∈[0,1]; no NaN/∞) decision tests. 356 green).
- **Next up — Track A (PIVOT 2026-06-14 → "launchable app first"):** build the runtime/shell so the
  **app itself is the on-rig test harness** (decision: defer all rig testing until the app is
  launchable — no more hand-running dumps in PowerShell). Key enabler: Electron + React + mic
  (`getUserMedia`) + audio + cloud LLM/STT/TTS **all run on macOS**, so the whole UX (talk to it, hear
  it answer, watch the dashboard) is buildable *and verifiable on the Mac* against the **synthetic
  sim-replay adapter** — the rig only swaps synthetic→live-LMU adapter + keyboard→wheel PTT.
  Order: ~~**T6.1** Electron boot~~ (done — electron-vite wired) → ~~**T6.2** dashboard~~ (done —
  pure `buildDashboardModel` + structured renderer; all docs/09 §A widgets + state-honesty colours,
  fixture-tested; Tailwind/shadcn reskin + Playwright deferred) → ~~text-ask the engineer (free/no-key
  Q&A in the shell)~~ (done, see below) → ~~wire the reactive radio loop + proactive router into the
  shell~~ (done, see below — offline half) → ~~**T4.5** mic/audio I/O~~ (done — mic permission +
  device picker + text fallback in the shell; real mic→STT / TTS→speaker streaming is T10.1) →
  ~~**T6.3** settings/secrets~~ (done — settings + BYO-key secure storage + a settings panel) →
  ~~LLM-route selector~~ (done) → ~~worker applies the engineer setting (text path)~~ (done — the
  `AskResponder` is now provider-aware: free template mode by default, or the configured LLM via
  `runRadioTurn`, **but only speaks the LLM answer when the hallucination guard passes**, else the
  grounded template; main resolves the route + decrypted key and pushes a `configure` message to the
  worker on a `ready` handshake and on every settings/secret change — key crosses main→worker only,
  never to the renderer; degrades to template on a keyless/invalid route or any provider error. So
  switching the engineer in Settings now takes effect for the text-ask.) → **T10.1 (in progress)**:
  ~~spoken text-ask replies~~ (done — the engineer now **talks back**: a free/no-key `SpeechController`
  speaks the text-ask answer via the browser Web Speech API / OS voice, with a mute toggle, degrading
  to text-only where unavailable; conversational-reply path only, separate from the tiered VoicePlayer,
  docs/07 reconciled; 479 green). ~~**PTT-mapping UI**~~ (done 2026-06-15 — the docs/08 §1 "press a
  button to map push-to-talk" flow. New **`apps/desktop/src/ptt-mapping.ts`**: a pure `PttMapper`
  coordinator (armed `InputReader` press-to-map → first debounced DOWN edge captured → persisted →
  `captured`/`cancelled`/`timeout`/`error` events) + the renderer↔main IPC contract
  (`ptt:map-begin/cancel/clear/get/event`) + `formatPttBinding`, all over **injected ports** (an
  `openReader` factory, emit/persist callbacks, an app clock, a timer scheduler) so the whole capture
  flow is unit-tested in Node with a `MockBackend`-backed real `InputReader` and a stepped clock — 10
  tests, 517 green. Imports from `@race-engineer/input` are **type-only**, and `main` builds the real
  reader behind a **dynamic import** (SDL2 on win32, `MockBackend` elsewhere), so koffi is isolated to a
  lazy chunk and the synthetic `pnpm dev` startup never loads it (build-verified). A `window.ptt`
  preload bridge + a renderer PTT row (Map / Cancel / Clear, live status) persist the bound `ButtonRef`
  into `AppSettings.ptt`. Read-only/advisory — passive button read, **no game write path**; compliance
  PASS. _Human (Windows rig):_ plug a wheel → "Map button" → press it → see it bound (the dev box has no
  joystick backend, so the flow runs but times out — the live capture is the rig half).) ~~**cloud cost
  estimator**~~ (done 2026-06-15 — closes the docs/15 "documented cloud cost/hour" / M10-gate deliverable.
  New **`apps/desktop/src/cost.ts`**: a pure `estimateCloudCost(settings)` → `$/hour` + `$/24 h-Le-Mans`
  + a hedged display summary, over a static LLM token-pricing table (Claude $1/$5 · $3/$15 · $5/$25 per
  1M in/out, docs/15) and the docs/15 usage basis (~30 interactions/h; defaults reproduce the doc's
  Haiku ≈ $0.15/h budget figure). Only **Claude** is a paid BYO-key route; the other cloud routes are
  free-tier and every selectable voice engine is local → `$0` (the `Record`-over-engine-id pricing makes
  a future paid engine a compile error until priced). State-honest: an unpriced paid model returns
  `null` → "depends on your model", never a guessed figure; the math is plain deterministic TS, the LLM
  never prices itself (rule 1). Imports are **type-only** so the renderer pulls no ai/voice runtime
  (build-verified: renderer stays lean, 9 modules, no AI graph); the settings panel shows the estimate,
  live on provider change. 11 tests, 528 green; compliance PASS.) ~~**proactive call-outs spoken aloud**~~
  (done 2026-06-15 — the engineer now **proactively talks** in the running app, free/no-key. New
  **`apps/desktop/src/callout.ts`**: a pure `calloutForEvent(event)` maps a Tier ≥ 1 event to a terse
  fixed phrase (`SPOKEN_PHRASES`) + the event's own `priority`, and a `CalloutSpeaker` (over an injected
  `CalloutSpeechPort`) speaks the highest-priority pending call-out with **priority preemption** (a more
  urgent one cuts in; a lower-or-equal one that can't preempt is dropped, not queued stale), an id-dedupe
  (snapshot-replay safe), and a mute. The renderer feeds it the **same `snapshot.events` feed it already
  paints as alert chips** and wraps `window.speechSynthesis` (the proactive sibling of the conversational
  `SpeechController`); a 📢 Call-outs toggle mutes it. **Tier-0 reflex spotter calls
  (`car_left`/`car_right`/`three_wide`) are excluded by a structural `tier === 0` guard** — those must be
  pre-rendered clips on the `VoicePlayer` <300 ms safety path (docs/01/07), never live `speechSynthesis`;
  Tier-2 events get a terse templated fallback here (a deliberate free-profile degraded mode, the richer
  payload-number/LLM phrasing being the premium `templatePhraser`/native path). No number invented — the
  Core already detected the event (rule 1). Imports are **type-only** so the renderer pulls no
  ai/voice/radio/core runtime (build-verified: 10 modules, no AI graph). 12 tests, 540 green; compliance
  PASS (rule 2 Tier-0 fix applied + re-reviewed).) ~~**audio-out bridge**~~ (done 2026-06-15 — the
  tiered `VoicePlayer` now plays through the **renderer↔worker audio bridge**, the first of three
  voice-loop slices. New **`apps/desktop/src/audio-bridge.ts`**: a pure `IpcAudioSink` (worker-side
  `AudioSink` that serializes `play`/`stop`/`volume`/`device` to the renderer over an injected `post`,
  correlating completion by a monotonic **playback id** — clip ids aren't unique since Tier-0 clips are
  reused) + `createAudioReceiver` (renderer-side: drives a real `AudioSink` backend and posts `ended`
  back), both **unit-tested over injected ports** incl. a round-trip through a real `VoicePlayer`
  (queue drain on renderer-reported end + SPOTTER-preempts-CHATTER across the bridge; 9 tests, 582
  green). `AudioClip` gained an optional `audio` byte payload and `synthesizeClip` now **retains** the
  synthesized bytes (it discarded them before). Wired Electron: worker posts `audio` messages via
  `parentPort`; `main` relays them to the **main window only** (the overlay never plays audio) and
  relays the renderer's `audio-ended` back; `preload` exposes `window.audioOut`; the renderer plays
  clip bytes via Web Audio (Blob URL) on the shared `engineer-audio` element so the output-device
  picker routes the engineer voice. Replaces the old silent `headlessAudioSink`. Read-only/advisory —
  audio out + an ended ack only, no game path; compliance PASS (rules 5/2/6). **Not yet audible:** the
  default `FakeTtsProvider` produces metadata-only clips (the queue drains silently); audibility needs
  a real TTS to fill the bytes — the next slice. _Verify split (per [[windows-only-runtime-mac-dev]]):_
  the Web-Audio playback + bridge verify on the dev **Mac**; the OS audio sink + device routing are a
  Windows-runtime verify.) ~~**mic→STT input** (slice 2/3)~~ (done 2026-06-15 — the push-to-talk radio
  input path. New **`apps/desktop/src/mic-bridge.ts`**: a pure `BridgedMicSource` (worker-side
  `MicSource` **frame receiver** that `RadioCapture` feeds from — `handleFrame` routes a frame to the
  active capture, gated by start/stop so frames outside PTT are dropped) + `createRadioInput` (renderer
  coordinator: PTT-down starts mic capture + emits the down edge, PTT-up stops + emits up; idempotent),
  both **unit-tested over injected ports** incl. a round-trip renderer-capture → worker
  `RadioCapture(FakeStt)` → transcript (4 tests, 586 green). The STT runs in the **worker** so a future
  key never reaches the renderer (rule 6); the renderer only captures the mic (`getUserMedia` →
  `MediaRecorder`, PTT-gated — capture runs **only while held**, no wake word) and ships opaque frames.
  Wired Electron: renderer→worker `radio:ptt` + `radio:frame` (type-guarded relay in `main`),
  `window.radioIn` preload bridge, a 🎙 **Hold to talk** button (pointer down/up/leave/cancel → PTT
  edges); worker builds a `RadioCapture(FakeSttProvider, BridgedMicSource)` and **logs the transcript**.
  Read-only/advisory — radio audio *in* + a PTT boolean only, no game path; compliance PASS (rules
  5/6/2 + privacy gating). **Not yet understanding speech:** the `FakeSttProvider` won't transcribe
  real audio bytes — this slice proves the capture *plumbing* (PTT→mic→frames→STT-stream→transcript).
  _Verify split:_ the coordinator + worker gating are Node-tested; `getUserMedia`/`MediaRecorder`
  capture verifies on the dev **Mac**; the OS mic device + the mapped **wheel** PTT are a Windows verify.)
  ~~**reactive reply** (slice 3a/3)~~ (done 2026-06-15 — push-to-talk question → **spoken answer**. New
  pure **`apps/desktop/src/radio-reply.ts`** `createRadioReply({ capture, answer, speak, bargeIn })`:
  PTT-down → barge-in + open capture; PTT-up → finalize → `answer(transcript)` → speak the reply out
  the audio-out bridge (slice 1), chaining turns so `whenIdle()` is deterministic and a provider error
  never breaks the chain. The answer reuses the **provider-aware `AskResponder`** (the *same* grounded
  brain as the text-ask — free template by default, the configured LLM when set, **hallucination-guarded
  either way**: an ungrounded LLM number falls back to the template, rule 1). `EngineerVoice` gained
  `speakReply` (sentence-streamed TTS at CHATTER, so a spotter/strategy call-out still preempts) +
  `bargeIn`. Worker wires capture → reply → `speakReply`; `engineer-worker` passes `responder.answer`.
  Pure orchestrator unit-tested (PTT flow, empty-transcript/empty-reply no-ops, reject-safe chain,
  RadioCapture round-trip) — 5 tests, 591 green; compliance PASS (rules 1/5/2/6). So the engineer now
  **answers a push-to-talk question aloud**, free/no-key (template) or via the configured LLM. **Still
  silent/scripted** with the fake STT/TTS — slice 3b makes it real.) ~~**cloud TTS provider**
  (slice 3b-i)~~ (done 2026-06-15 — the first **real** voice engine, mirroring the cloud-LLM providers
  (T5.1b). New **`packages/voice/src/providers/cloud-tts.ts`** `CloudTtsProvider` (OpenAI-compatible
  `POST /audio/speech` → binary audio): `synthesizeStream` yields the bytes, `prerender` **retains the
  bytes + MIME** so Tier-0 clips are audible; `fetch` is **injectable** (mocked-transport tested — no
  key, no network), the **key comes from config/OS secure storage, never embedded** (rule 6), and it
  calls the vendor directly — no central server. Added `'openai'` to `TtsEngineId` + `cloudTtsConfig`
  to `VoiceProviderConfig`, so `selectTtsProvider` swaps to it config-only (no key ⇒ not-ready →
  caller falls back). Widening the engine enum forced the cost estimator to **price** it — `openai`
  TTS ≈ $0.10/h (docs/15 §Cost scenarios "Budget cloud"), so a paid engine can't read as free. 9
  mocked-transport tests (request mapping, Bearer key, binary→chunk, prerender bytes+MIME, readiness,
  error-throws, selector swap), 600 green; compliance PASS (rules 6/5/1 + state-honesty). **Provider
  built + offline-tested; not yet wired into the running app.**) ~~**wire cloud TTS into the worker**
  (slice 3b-ii)~~ (done 2026-06-16 — the cloud TTS is now **audible in the running app** with your key.
  New **`apps/desktop/src/voice-route.ts`** `resolveVoiceRoute(settings.voice, secrets)` → a
  **serializable** `VoiceProviderConfig` (engine ids + `cloudTtsConfig:{apiKey}` only when tts=openai;
  key from secure storage, **main-side only**) + `voiceRouteIsCloud`; the route rides the `configure`
  message (main→worker, never the renderer — rule 6). The **worker (re)builds the voice layer on
  configure** when a cloud engine is selected (or `ENGINEER_VOICE=1`): `worker-voice` builds TTS/STT via
  `selectTts/SttProvider(route)`, **falling back to the fake** when not-ready (no key) or if the cloud
  Tier-0 pre-render fails (bad key/offline) — never crashes (docs/16 §1). Rebuilds serialized + de-duped
  by route key so rapid saves can't race or re-bill the pre-render. Settings gained a **Voice** TTS-engine
  dropdown (`TTS_ENGINES` exported, `'openai'` added; cost estimator already prices it $0.10/h). 605
  tests + a `resolveVoiceRoute` suite green; typecheck (both) + lint + electron build green; compliance
  PASS (rule 6 key-handling verified clean — key never reaches the renderer, never logged; Tier-0 stays
  pre-rendered). **So: select Voice=openai + paste an OpenAI key → the engineer speaks text-ask replies +
  proactive call-outs in a real cloud voice.** _Human-verify (you + OpenAI key + speakers):_ confirm
  audible.) ~~**cloud STT for voice-in** (slice 3b-iii)~~ (done 2026-06-16 — **the full talk-to-it loop
  is now testable**. New **`packages/voice/src/providers/cloud-stt.ts`** `CloudSttProvider` (OpenAI-
  compatible `POST /audio/transcriptions`, multipart): buffers the held-PTT mic frames and transcribes
  on release (batch — no streaming partials); `fetch` injectable (mocked-transport tested), key from
  config/secure storage **never embedded** (rule 6), available=key-present, non-OK throws. `'openai'`
  added to `SttEngineId` + `cloudSttConfig`; `selectSttProvider` swaps to it config-only; cost estimator
  prices it $0.02/h (docs/15). `resolveVoiceRoute` attaches `cloudSttConfig` (the **same OpenAI key** as
  TTS) and `voiceRouteIsCloud` now activates on TTS **or** STT; Settings gained a **Mic** STT-engine
  dropdown. 614 tests; typecheck (both) + lint + electron build green; compliance PASS (rule 6 key-
  handling clean, never-crash fallbacks, reject-safe consumer). **So with one OpenAI key + Voice=openai
  + Mic=openai: hold 🎙 Hold-to-talk → it transcribes your speech → answers (template or LLM, guarded) →
  speaks back in a real cloud voice.** _Human-verify (you + OpenAI key + mic + speakers):_ confirm the
  end-to-end loop.) **Remaining T10.1:** the **local native backends** (Piper/Kokoro + faster-whisper
  binaries — the free, no-key default; rig/native) and the **wheel PTT** (SDL2.dll on the rig — the
  on-screen 🎙 button needs no SDL2). (~~Piper TTS backend done 2026-06-16~~ — `piperTtsBackend()` in
  `apps/desktop/src/voice/piper-backend.ts` fills the `piperTts` injected-backend seam: spawns
  `piper --output-raw --model …`, writes text to stdin, streams stdout PCM as `AudioChunk`s. The
  spawner is **injected**, so it's unit-tested offline with a fake child process — no binary needed;
  the real binary/model come from the model manager (T4.6). 7 tests; compliance PASS. ~~whisper.cpp STT
  backend done 2026-06-16~~ — `whisperCppBackend()` in `apps/desktop/src/voice/whisper-backend.ts`
  fills the `whisperCppStt`/`fasterWhisperStt` seam: batch-shaped (buffers held-PTT frames, on `finish`
  writes a temp WAV, runs `whisper-cli -m … -f … -nt`, returns the stdout transcript); spawner **+** fs
  **+** tmp/clock all injected, so it's unit-tested offline with fakes (no binary, no disk), cleans up
  the temp file in a `finally`, and surfaces a spawn error rather than silent empties. 8 tests; 765
  green; compliance PASS. ~~worker/selector wiring done 2026-06-16~~ — `attachLocalBackends(route)`
  (`apps/desktop/src/voice/local-backends.ts`) supplies the Piper/whisper backends to the route for
  local engines **whose binary path is configured** (else the shell stays not-ready and the worker
  falls back to the fake — honest readiness, no spawning a missing binary); `worker-voice.ts` applies
  it before `selectTts/SttProvider`. 6 tests; 771 green; electron typecheck green; compliance PASS.
  ~~model-path resolution + build-gate done 2026-06-16 (Windows)~~ — the free/offline voice pair can now
  be **turned on by config alone**. `AppSettings.voice.local` (`VoiceLocalPaths`: `piper`/`whisperCpp` →
  `{ binaryPath?, modelPath? }`, **non-secret** plain paths, tolerant-parsed — empties/garbage dropped,
  never a stray key) records where the installed Piper/whisper.cpp binaries+models live; `resolveVoiceRoute`
  resolves them into the route's `ttsConfig`/`sttConfig` for the matching local engine. Shared readiness
  predicates `ttsLocalReady`/`sttLocalReady` (piper/whisper-cpp **with both binary+model paths**) are now
  the **single source of truth** used by *both* `attachLocalBackends` (wire the native backend) and the
  worker build-gate, so they can't drift; `voiceRouteIsReady = voiceRouteIsCloud || voiceRouteIsLocalReady`
  widens `shouldBuildVoice` so a **configured local route turns the audible voice on with no env flag**,
  while the bare free default (`kokoro`+`faster-whisper`, no backends/paths) stays off — the silent
  `pnpm dev` demo is untouched. +10 tests (788 green); typecheck + lint + electron build green; compliance
  PASS (rules 5/6/2 + honest readiness — a not-ready local engine falls back to the offline fake, never
  spawns a missing binary). **Next:** the **model-manager auto-fill** (T4.6 `ModelManager.ensureModel` →
  real free-profile Piper/whisper specs (URLs + SHA-256, **can't be guessed — rig/decision**) → write the
  resolved paths into `voice.local`) + a **Settings path picker** so a user can point at existing binaries;
  the **Kokoro ONNX** + **faster-whisper** backends (the default-profile engines; until then the working
  free pair is piper+whisper-cpp); and a **Mac/Windows smoke-test** with a real Piper voice + whisper model.
  The OS audio sink is already bridged. _Runtime note:_ whisper-cli wants 16 kHz mono WAV/PCM, so the local
  STT path needs the mic captured as WAV/PCM (or a whisper build with ffmpeg) — a rig/runtime alignment,
  docs/07.) ~~Local Piper voice made audible 2026-06-16 (Windows, rig-verified)~~ — the Piper backend now
  buffers Piper's *headerless* raw PCM and emits it **WAV-wrapped** (sample rate read from the voice
  `<model>.onnx.json`, injected for tests) so the renderer `<audio>` element decodes it (raw PCM was
  silent); `LocalTtsProvider.prerender` now **retains** the synthesized bytes like the cloud provider, so
  Tier-0 clips are audible (were metadata-only). Verified end-to-end on the rig: real `en_GB-alan-medium`
  Piper output through the **app-identical `pcmToWav`** plays as clear speech (driver-confirmed). +4 tests
  (792 green); typecheck + lint + electron build green; compliance PASS (rules 5/6/2). **Two rig findings:**
  (1) Piper/onnxruntime **crash on a non-ASCII install path** — this profile is `…\Alexander Grønning\…`,
  and onnxruntime mangles the `ø` (`Gr�nning`) and dies loading the model; local-voice models must live at
  an **ASCII path**, so the model manager (T4.6) must install/copy there rather than straight into the
  non-ASCII `userData` dir. (2) Capturing Piper's binary stdout must use `child_process` (the app's path) —
  a PowerShell `1>` redirect corrupts the bytes (text pipeline) into static, a test-harness trap only.
  ~~Now talks *in the app* 2026-06-16 (driver-confirmed: British Piper voice for the proactive call-outs).~~
  Two more bugs our audio path surfaced + fixed: (a) the renderer plays clips through an `<audio>` element
  whose **CSP** (`default-src 'self'`) blocked the `blob:` audio URL → silent; added `media-src 'self' blob:`
  to `renderer/index.html` (+ `autoplayPolicy: 'no-user-gesture-required'` so call-outs play without a
  click). (b) The renderer's free **Web-Speech** call-out fallback (`CalloutSpeaker`) double-spoke over the
  real voice in a robotic OS voice; the worker now posts a `voice-active` signal over the audio bridge and
  the renderer **mutes the Web-Speech fallback when the real (Piper/cloud) voice is live** — keeping it only
  as the no-worker-voice fallback. 793 green; compliance PASS. _Still:_ a Settings path picker for
  `voice.local` (paths are seeded by editing `settings.json` for now), and the typed ask-bar reply still
  uses Web-Speech (only proactive call-outs + PTT replies use the Piper path) — a follow-up to route it
  through the worker voice too.
  M7.7–M7.9 / M8 / M9 offline-strategy depth are paused until the app is launchable. (Offline glue
  done: `get_stint_plan` + `project_pit_window` are now wired into the AI read-only tool surface,
  reading a precomputed `ctx.stintPlan` (T7.3) like `get_fuel_plan` reads `ctx.fuelPlan`; 373 green.
  Still pending: `evaluate_undercut` — needs per-rival tyre-gain/pit-loss context fields the Core
  doesn't expose yet.) **Always-on strategy engine done (2026-06-15):** `engineer-core`'s
  `StrategyEngine` accumulates green-lap fuel deltas + lap times from the `RaceState` stream and
  recomputes a live **`FuelPlan`** into every snapshot (`EngineerSnapshot.strategy.fuelPlan`); the
  dashboard surfaces "add at stop". So the strategy models now compute at runtime in the app
  (synthetic + live LMU). The Core also runs the **Event Detector** (`defaultEventRules`:
  spotter/traffic/FCY/fuel-low/lap-completed) over the stream and attaches fired events to each
  snapshot (`EngineerSnapshot.events`); the dashboard shows a rolling **alerts** feed. So the event
  system runs live in the app now — the proactive *voice* routing of those events is still the radio
  layer. Feeding strategy into the AI `ctx.fuelPlan`/`ctx.stintPlan` lands with the radio loop;
  stint/undercut need the per-track calibration inputs (rig backlog).
  **Template-mode answering done (2026-06-15):** `templateAnswer(question, ctx)` in `ai` — the
  free/offline/no-key reactive engineer (docs/15): matches a question to an intent, reads the
  read-only tools, and phrases a grounded answer (fuel/pit/tyres/position/lap-time/aids) quoting tool
  numbers verbatim, no LLM. Returns null on no match → caller falls back to a configured LLM.
  **Text-ask the engineer done (2026-06-15):** the desktop app now *answers you*, free/no-key. New
  `askEngineer(question, ctx)` in `ai` (template mode + a guiding fallback — always returns a spoken
  answer, the seam where a configured LLM plugs in later). The snapshot→`RaceContext` bridge +
  `AskResponder` (latest-snapshot holder) live in `apps/desktop/src/ask.ts` (pure, unit-tested) — the
  *same bridge the voice radio loop reuses next*. Wired through the shell: a renderer ask-bar →
  read-only `ASK_CHANNEL` (`invoke`/`handle`, request/response — **no game write path**) → the Core
  **worker** answers off the UI thread from its freshest snapshot → reply painted in the renderer. The
  AI brain bundles only into the Node worker, never the renderer (build-verified: renderer stays 4
  modules). 411 green. _Human (dev machine, macOS ok):_ `pnpm dev` → type "how's my fuel?" → see the
  grounded answer (the live half).
  **Voice layer wired into the shell done (2026-06-15) — offline half:** new
  `apps/desktop/src/voice-engine.ts` `EngineerVoice` composes the radio layer (`ProactiveVoiceRouter`
  + `ReactiveRadioLoop`) over one `VoicePlayer`: `routeEvents` (Core events → call-outs), `onSnapshot`
  (freshest `RaceContext` via the shared `snapshotToRaceContext` bridge), `onPtt` (PTT → STT → AI →
  streamed TTS). Proactive default is free/no-key (`templatePhraser`); the reactive loop is built only
  when a provider + capture are supplied (else `onPtt` no-ops). `engineer-core` gained an immediate,
  off-throttle `onEvent` hook (snapshots still carry events for the dashboard) so a Tier-0 spotter
  call-out routes a snapshot-interval sooner; threaded through `host.ts`/`lmu-host.ts`. The worker
  routes Core events to the voice layer behind `ENGINEER_VOICE=1` (free/offline, **audio silent until
  the real OS sink lands in T4.5/T10.1** — routed call-outs are logged; the voice/radio/ai graph
  dynamically imported only when enabled; default `pnpm dev` demo untouched). Read-only/advisory —
  audio + mic only, no game path. 420 green; compliance PASS. **T4.5** makes it audible (OS sink +
  `getUserMedia` mic + wheel PTT); the live reactive loop should also register the T5.3
  `onHallucinationCheck` then.
- **Track B (needs the Windows rig + LMU) — app can now drive it (2026-06-15):** the launchable app
  is the test harness. **`pnpm dev:lmu`** drives the dashboard from the **live LMU shared-memory
  source** (`apps/desktop/src/lmu-host.ts` — `LmuAdapter` + `createLmuNormalizer`, dynamically loaded
  only when `ENGINEER_SOURCE=lmu`; koffi stays external; the synthetic demo never touches it). So rig
  validation now happens by *watching the dashboard* with LMU running, not PowerShell. When it
  resumes: **`pnpm capture`** (one-shot REST + `.svm` dump → `lmu-capture.json`, the first rig step —
  confirms the LIVE-VERIFY field names for VE / aids / setup in one pass); **T1.5** `pnpm record` a
  real stint → trimmed fixture; **T2.2
  live** REST probe → finish REST→`RaceState` mapping + settle S3 aids; **T1.3/T1.4** aids/setup reads;
  confirm the gap/`lateralPos`/closing signs + brake-bias front/rear + FCY/pit enums. **Full
  actionable list:** the **Rig verification backlog (consolidated)** in
  [03-LMU-INTEGRATION.md](03-LMU-INTEGRATION.md) — signs/conventions, FCY/pit/sector enums, and the
  **strategy-model calibration inputs** (pit-loss, refuel rate, Virtual Energy, tyre life, mandatory
  stops) the T7.x models need real values for.
- **Virtual Energy correctness fix (M11, started 2026-06-16):** the fuel/strategy math was
  litres-only; in LMU a stint is often bound by the per-stint **Virtual Energy** budget, not fuel.
  **T11.1 done** — VE is now a first-class quantity parallel to fuel in the canonical schema
  (`PlayerCar.virtualEnergy`) and the plan (`FuelPlan` VE fields + `bindingConstraint`), with the
  same robust estimator and a binding-constraint = `min(fuel laps, VE laps)`. **T11.2 done** — VE
  now flows live: the synthetic source emits a VE arc, the always-on `StrategyEngine` learns per-lap
  VE like fuel and computes the binding constraint each snapshot, and the dashboard (models +
  renderer) shows a Virtual Energy card with an "Energy-limited" badge (634 green; electron build +
  compliance PASS). **T11.4 done** — the AI surface is VE-aware: `get_fuel_plan`/`get_race_state`
  expose VE (as %) + the binding constraint, the free template answers energy questions and makes the
  fuel answer VE-aware, and the system prompt flags the energy-limited case (641 green; compliance
  PASS). **T11.3 offline half done** — a tolerant REST→canonical VE mapper + RaceState merge seam
  (`virtualEnergyFromRest`/`withVirtualEnergyFromRest`), unit-tested (650 green; compliance PASS).
  **M11 is now offline-complete** (incl. **T11.5** — a proactive `energy_low` voice call-out, the VE
  sibling of `fuel_low`); all that remains is T11.3's **live half** — capturing the real
  `/rest/strategy/usage` payload on the rig to pin field names + wiring the ~2 Hz REST poll into the
  live host (rig backlog, docs/03 §C). See M11 below.

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

**T1.1 — S1: raw shared-memory dump** · _human-assisted_ · deps: T0.2 · **done**
Build: standalone koffi script: `OpenFileMapping`/`MapViewOfFile` on the rF2 SMMP buffers,
torn-read guard, dump key telemetry/scoring fields. _Human:_ install the plugin into LMU,
run a session.
Verify: ✅ live fuel/tire/position values print and match the in-game HUD — confirmed across four
live captures (docs/03 §S1 #1–#4): plugin loads on the current LMU build, `pack=4` decode correct,
all key fuel/tyre/brake/position/gap/lap-time fields populate. **S1#4 (2026-06-16)** re-confirmed on
the installed build (`C:\SteamLibrary\…\Le Mans Ultimate`) and fixed a real decode bug — driver-name
strings are **UTF-8**, were read as `latin1` (mojibake on accented names); `readChars` now decodes
UTF-8 (regression-tested, 615 green). New observations logged for T2.3: `mPlace` is **not unique**
(player seen in two scoring slots → dedupe `cars[]` by `mID`); raw `mTimeBehindLeader/Next` read `0.0`
for trailing cars (derive gaps, already handled canonical).
Output: ✅ install path, enable flags, populated fields, decode fix + open items → doc 03 §S1 #1–#4.

**T1.2 — S2: REST API probe** · _human-assisted_ · deps: T0.2 · **done**
Build: probe `localhost` (≈`:6397`), enumerate endpoints, capture sample payloads.
Verify: ✅ live probe 2026-06-16 (docs/03 §"S2 — live confirmation"): base `http://127.0.0.1:6397`
(IPv6 refused); authoritative spec `/swagger-schema.json` (OpenAPI 2.0) → **178 paths, 107 non-GET**
(GET-only avoid-list). Standings/session/strategy/garage payloads retrieved. **Fields that beat SHM:**
`/rest/watch/standings` (per-**class** gaps, sector splits, `fuelFraction`/`veFraction`);
`/rest/sessions/GetGameState` (FCY/pit enums as strings); `/rest/garage/getPlayerGarageData`
(**current aids** — engine mixture/brake balance/VE/compound — resolving the open **S3** question, with
live TC/ABS *level* the one remaining verify); `/rest/strategy/{usage,pitstop-estimate}` (VE + pit-time
breakdown); `/rest/garage/UIScreen/TireManagement` (tyre sets). Read-only confirmed (GET-only; 107
write endpoints deliberately avoided).
Output: ✅ endpoint list + schemas + read-only confirmation → doc 03 §S2 live. (REST→`RaceState`
mapping is T2.2/T2.3 forward work.)

**T1.3 — S3: current-aid readability** · _human-assisted_ · deps: T1.1 · **done**
Verify: ✅ determined (docs/03 §S3, S2/S4 live 2026-06-16). **Baseline** TC-map/ABS-map/engine-mixture/
brake-balance/VE/compound are readable from REST `getPlayerGarageData` (== the `.svm` file); live
**brake bias** from SHM. **Definitive negative:** the *live* in-cockpit TC/ABS/mixture *level* the driver
dials on track is **not** externally readable — `getPlayerGarageData` is a frozen garage snapshot (full
JSON static all session while toggling + driving + burning fuel), SHM doesn't carry it (S1#3), `/rest/hud`
has none. So the engineer advises aids from the **baseline**, in **relative clicks**, and never claims the
live level. (Read-only — we never write them.)
Output: ✅ source + field locations → doc 03 §S3 + "S2/S4 — live confirmation".

**T1.4 — S4: setup file read** · _human-assisted_ · deps: T1.1 · **done**
Build: ✅ located the setup dir + built a **read-only `.svm` parser**
(`packages/adapters/lmu/src/setup/svm.ts` — `parseSvm`/`parseSvmFile`/`extractSetupBaseline`/
`toSetupSummary` → canonical `SetupSummary`; 8 tests, synthetic fixture).
Verify: ✅ parsed values match the in-game garage / live REST baseline (ABS `9 (Understeer)`, mixture
`Race`, compound `Medium`, VE `100%`). Never writes (rule 5). **Finding:** values are setting *indices*
but LMU **embeds the display string in the `//` comment**, so it's recoverable per-entry.
Output: ✅ location + format notes → doc 03 §"S4 — live confirmation".

**T1.5 — Record a real session** · _human-assisted_ · deps: T1.1 → **tooling ready (T2.4)** · **done (fuel-burn fixture); full convergence gate deferred**
Build: ✅ captured a real GT3 stint **with fuel consumption on** (`pnpm record`), added `tools/trim-fixture.ts`
(downsample + prune cars + **scrub the player's name** — PII-safe), and committed a trimmed fixture
`packages/adapters/sim-replay/fixtures/lemans-fuel-stint.replay.jsonl` (146 frames, ~750 KB, 3 green laps).
Verify: ✅ `pnpm replay` / `pnpm eval replay` run it through the pipeline; the fuel-accuracy eval is now
**non-silent on real data** and recovers a realistic **~3.0 L/lap** ground truth (CI test added) — the
first genuine fuel-burn telemetry through the eval. **Still open:** the docs/10 Phase-2 **±1-lap-by-mid-
stint convergence gate** does *not* pass on this 3-lap stint (one a standing-start partial — too few clean
green laps to converge); closing it needs a **≥5-lap clean green stint** (rig backlog — driver has since
closed LMU). The earlier "pass" was a frozen-tail artifact (sim paused) and was corrected.

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
**Rule set since extended:** spotter (T3.4), traffic/FCY (T7.5/T7.6), strategy call-outs (T7.9),
`energy_low` (T11.5), and ~~`tire_temp_out_of_window` (done 2026-06-16)~~ — a declared `EventType`
that previously had no detector. `tireTempRule` (`events/rules/tire-temp.ts`) fires Tier-1 hot/cold
call-outs when a player tyre's representative temp leaves the operating window (default 80–100 °C),
one per direction per cooldown, **suppressed in the pit lane**; the radio `templatePhraser` speaks it
("Tyres are overheating — ease off" / "below temperature — push to get heat in"). 7 rule tests + a
phrasing test; 690 green; compliance PASS. (Magnitude window is rig-tunable per car/compound.)

**T3.3 — Persistence (SQLite) + learning priors** · _Claude Code_ · deps: T3.1
Build: better-sqlite3 repos; `sessions`/`laps`/`fuel_models`; prior blend feeds `confidence`.
Verify: write/read round-trip; priors shift estimates as samples accumulate (tests).

**T3.4 — Spotter geometry** · _Claude Code_ · deps: T2.3 (or synthetic positions)
Build: `car_left`/`car_right`/`three_wide`/`clear` events from world positions + closing rate
(events only; audio in M4).
Verify: synthetic side-by-side scenario produces correct, debounced events.

---

## M4 — Voice & input (the radio plumbing)

**T4.1 — Input reader + PTT mapping** · _Claude Code (mapping verify human-assisted)_ · deps: T0.2 · **done (live-verified on the rig 2026-06-16)**
Build: backend-agnostic `InputBackend` + `EdgeDetector` (lockout debounce), `BindingSet` +
`ButtonCapture` (press-to-map), `InputReader` (PTT down/up + quick actions on press, own poll
loop off the hot path), `MockBackend`. Windows-only `Sdl2Backend` (koffi, passive/non-exclusive
joystick read) loads `SDL2.dll` lazily, so it typechecks on macOS but is not run there.
Verify: ✅ logic/debounce unit tests with a mock device (17 tests). **✅ Live-mapped a Fanatec wheel
button in the running app (driver-confirmed).** Two rig fixes made it work: (1) init
`SDL_INIT_VIDEO | SDL_INIT_JOYSTICK` — VIDEO creates SDL's hidden message-only window + event pump
that Windows device input needs; JOYSTICK alone enumerates the wheel (Fanatec, 63+108 buttons) but
reads **no** button state in a process without its own message loop. (2) Force DirectInput
(`SDL_JOYSTICK_RAWINPUT=0`) — the default RAWINPUT driver needs a real window — plus
`SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS=1` (read while the game has focus; we never grab the device —
rule 5). `pollPressed` now `SDL_PumpEvents()` + `SDL_JoystickUpdate()`. `main` takes a
`ENGINEER_SDL2_DLL` path override (else the bundled `SDL2.dll`). Compliance PASS (read-only: only
enumerate/poll calls, no force-feedback/injection).
_Remaining (packaging/polish, not blocking):_ **bundle `SDL2.dll`** with the installer (T10.5) so
the bare-name default resolves; the `TODO(rig)` niceties — stable device GUID
(`SDL_JoystickGetGUIDString`, currently name#index, fine for a fixed rig) and hot-plug
re-enumeration. _Note:_ a single Fanatec base enumerates as 2 SDL devices (name#index distinguishes
them); confirmed passive reads don't disturb the game's own input.
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

**T4.5 — Microphone permission + audio I/O** · _Claude Code (live verify human-assisted)_ · deps: T4.3 · **done (logic + shell affordance)**
Build: new `apps/desktop/src/audio-io.ts` — the renderer audio-I/O primitives written over small
**injected ports** (no DOM lib, so unit-testable in Node; the renderer passes the real
`navigator.mediaDevices`/`<audio>`): `requestMicAccess` (getUserMedia probe → granted | denied /
no-device / in-use / unsupported / error guidance, **never throws** — docs/16 §1), `releaseStream`
(probe is released immediately — capture stays PTT-gated), `listOutputDevices`, `watchDeviceChanges`
(hot-plug/default-change), `applyOutputDevice` (`setSinkId`, degrades gracefully), and
`MIC_SETTINGS_DEEPLINK`. Shell wiring: a read-only `OPEN_MIC_SETTINGS_CHANNEL` (`EngineerBridge.openMicSettings`)
→ main `shell.openExternal('ms-settings:privacy-microphone')` (**fixed constant URL — not an
open-anything hole**) + `session.setPermissionRequestHandler` granting only `media`; a renderer
voice-bar (🎤 Test mic → guidance + "Open settings" on denial, output-device picker routed via
`setSinkId`). The text-ask box is the no-mic fallback. **Read-only/advisory — mic in + the
engineer's own audio out, no game path.**
Verify: ✅ 11 unit tests (every mic-failure path → guidance not a throw; enumerate filters audiooutput
+ flags default; devicechange subscribe/unsubscribe; setSinkId routing + graceful unsupported/error)
(431 green); electron-vite build green (renderer stays lean — no AI graph); compliance PASS. _Human
(dev machine — macOS ok for the mic/output prompts):_ `pnpm dev` → Test mic (allow/deny → see
guidance), pick an output device. **Live half:** real mic→STT and TTS clip→speaker streaming
(renderer↔worker audio path) lands with T10.1; the Windows `ms-settings:` deep-link verifies on the rig.
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

**T6.1 — Electron shell + worker-hosted Engineer Core + typed IPC** · _Claude Code (window-open verify human-assisted)_ · deps: T0.5 · **done (boot wired)**
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
snapshots to a spy transport (7 tests; 228 green). **Boot wired (2026-06-15):** electron-vite
bundles all four entries (`main`/`engineer-worker`/`preload`/`renderer`) — `build:electron` is green
and verified to compile; `"type":"module"` dropped so main/preload emit CJS (sandboxed preload + `__dirname`),
`out/` git/lint/prettier-ignored, CI skips the Electron binary. _Human (dev machine, macOS ok):_
`pnpm install` then `pnpm --filter @race-engineer/desktop dev` → window streams ~12 Hz synthetic
values (the only remaining verify; README §Running).

**T6.2 — Live dashboard** · _Claude Code_ · deps: T6.1 · **done (logic + renderer; reskin deferred)**
Build: a **pure** `buildDashboardModel(snapshot)` view-model in `apps/desktop/src/dashboard` mapping
the canonical `RaceState` to all docs/09 §A widgets — fuel (big laps-left), 4-corner tyres (temp vs
window + wear% + pressure), 4-corner brakes, aids (TC/ABS/brake-bias/engine-map), position + nearest
ahead/behind (name + class + gap + closing arrow) + faster-class strip, timing (last/best/Δ), session
(phase/flag/remaining) — each value pre-formatted + classified by the docs/09 **colour language**
(good/caution/critical + `neutral` for unjudged + `unknown` for null; **state honesty:** null → `—`,
never a fabricated 0/colour). The renderer paints it into a glanceable card grid (severity colour +
a non-colour glyph for colourblind a11y; `textContent` only). Redraw bounded by the Core's ~12 Hz
snapshot throttle.
Verify: ✅ `buildDashboardModel` unit-tested against the four canonical fixtures — fuel critical/good/
unknown, cold-tyre + worn-tyre + null-brake honesty, multi-class standings + faster-class strip, flag
severities, delta-to-best, neutral aids; property test (every reading has a valid severity, no `NaN`,
unknown ⇒ `—`) (13 tests; 371 green). `electron-vite build` bundles the renderer. **Deferred** (need a
display to iterate): the **Tailwind/shadcn reskin** of this same model and **Playwright** visual/
screenshot tests; shadcn lands with the interactive settings UI (T6.3). _Human:_ `pnpm dev` → eyeball.
Context: [09-UI-UX](09-UI-UX.md).

**T6.3 — Settings + secrets** · _Claude Code (live verify human-assisted)_ · deps: T6.1, T4.x, T5.1 · **done (data + secrets + persistence + panel); PTT-mapping UI + worker-apply deferred**
Build: the **settings + secrets foundation**. `apps/desktop/src/settings.ts` — `AppSettings` (the
**non-secret** config: profile / llm provider / voice engines / proactivity / output device / PTT
binding), `DEFAULT_SETTINGS` (free/template, no key), tolerant `parseSettings` (old/partial/corrupt →
defaults, **drops unknown fields incl. a stray "key"**), and a `SettingsStore` over an injected
storage port (normalizes on save). `apps/desktop/src/secrets.ts` — a `SecretStore` interface +
`InMemorySecretStore`; **keys live only in OS secure storage, never in the settings JSON, never logged,
never returned to the renderer** (the renderer learns only *which* slots are set). Electron live half
in `electron/stores.ts`: `fsSettingsStorage` + `SafeStorageSecretStore` (`safeStorage` encrypt →
ciphertext file, refuses plaintext if encryption is unavailable). Wired through a separate
`window.settings` bridge (load/save + set/delete/list keys) + main handlers (`whenReady`, slot-validated,
return set-slot names only). A renderer settings panel: profile / engineer (LLM) / proactivity persist;
an API-key slot+password control stores via `safeStorage` and shows which slots are set (never a value,
input cleared after save). **Read-only/advisory — config + the user's own keys, no game path.**
Verify: ✅ 12 unit tests — tolerant parse + per-field fallback, **no secret can reach the settings file**,
SettingsStore round-trip, secret set/get/has/delete/list (names-only) (443 green); electron-vite build
green (renderer stays lean; settings imports are type-erased); compliance PASS (rule 6 audited). _Human
(dev machine, macOS ok):_ `pnpm dev` → flip profile/engineer/chatter (persists across restart), paste a
key → "keys set: …", restart → still set; values never appear in logs.
**LLM-route selector done (follow-up):** `selectLlmProvider(config)` in `ai` (the AI sibling of voice's
`selectTtsProvider` — `template`→null free path, `ollama` key-less, cloud routes BYO-key-guarded; no
network at selection, vendor endpoints only, `baseUrl` override confined to Ollama so config can't proxy
a cloud route) + `resolveLlmRouteConfig(llm, secrets)` in the app (reads the key from secure storage at
the last moment). `LlmProviderId` is now ai-owned (single source of truth, settings re-exports it). 451
green; compliance PASS (rule 6). **Deferred (surface):** ~~the **PTT-mapping UI**~~ (done with T10.1 —
the `PttMapper` capture flow + `window.ptt` bridge + renderer PTT row; live wheel capture is the rig
half) and **the worker actually instantiating + using** the resolved provider/voice on startup/change
(the "mode switch takes effect" half) — lands with T10.1.
Context: [15-COST-AND-FREE-OPERATION](15-COST-AND-FREE-OPERATION.md), [16-PLATFORM-PREREQUISITES](16-PLATFORM-PREREQUISITES.md), [08-INPUT-AND-CONTROLS](08-INPUT-AND-CONTROLS.md).

**T6.4 — Overlay window** · _Claude Code (over-the-game verify human-assisted)_ · deps: T6.2 · **done (logic + window; over-the-game verify is the human half)**
Build: ✅ a pure `buildOverlayModel(snapshot)` in `apps/desktop/src/overlay-model.ts` that **reuses
`buildDashboardModel`** and projects the minimal docs/09 §Overlay widget set (fuel laps-left hero,
nearest car ahead/behind with class + gap, faster-class strip, flag, next pit window, last lap, latest
call-out) — every value already formatted/severity-classified/state-honest there, so the overlay
re-derives no number. A second renderer entry (`renderer/overlay.html` + `overlay.ts`) paints it from the
**same read-only snapshot stream** via the shared preload `EngineerBridge` (`textContent` only, strict
CSP). `electron/main.ts` owns the overlay `BrowserWindow` — **transparent, frameless, always-on-top
(`screen-saver` level), click-through (`setIgnoreMouseEvents`), `focusable:false`, `skipTaskbar`, hidden
by default** — created lazily on first toggle; a view-only `OVERLAY_TOGGLE_CHANNEL` + `toggleOverlay()`
on `EngineerBridge` (mirroring `openMicSettings`) show/hide it; an 🪟 Overlay button in the main window.
**Read-only/advisory — the overlay only displays snapshots; the toggle carries no data toward the game
(rule 5); click-through passes input to the game, never injects it.**
Verify: ✅ `buildOverlayModel` unit-tested against the canonical fixtures (fuel hero severity, unknown →
`—`, compact multi-class rivals + faster-class flag, latest call-out vs none) (5 tests; 545 green);
typecheck (incl. electron) + lint green; electron-vite build emits `overlay.html` and the renderer stays
lean (no ai/voice/radio/core runtime); compliance PASS. **Human (dev machine — borderless game):** toggle
the overlay, confirm it floats over a **borderless/windowed** game and is click-through (docs/09 caveat:
not exclusive-fullscreen DirectX). _Deferred (follow-up):_ drag-to-reposition, opacity/size presets, and
a live "engineer speaking/listening" indicator (docs/09).
Context: [09-UI-UX](09-UI-UX.md).

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
undercut/overcut~~ (done) → ~~T7.5 multi-class traffic forecasting~~ (done) → ~~T7.6 FCY/SC opportunism~~ (done) →
~~T7.7 learning layer~~ (done — **tyre** half: the fuel learning layer (T3.3) extended to tyre
degradation. New `tire_models` table (schema **v2**, additive/idempotent — an existing v1 store upgrades
in place without data loss, tested), `TireModelRepo` (one bucket per **car/track/compound**, folds each
completed stint's fitted slope+intercept into Welford running stats, accumulates across sessions), and
`tirePriorFromStats`/`tirePriorFromRecord` → a `TirePrior` that `fitTireDegradation` (T7.1) blends —
null until learned, weight saturates at the cap, prior-only fit reports confidence 0. Pure/deterministic,
clock injected; 463 green; compliance PASS. _Still pending:_ wiring the tyre prior into the live
`StrategyEngine` + the replay-eval on recorded stints, with T1.5.) → ~~T7.8 strategy UI + rival
tracker~~ (done — pure `buildStrategyModel(snapshot)` in `apps/desktop/src/dashboard/strategy-model.ts`:
the full stint plan (boundaries, fuel loads, pit windows, expected-degradation with severity, the
**current-stint** flag), fuel to-finish + save target, and a **multi-class rival tracker** (nearest N
cars ahead/behind with gap + closing + same-class highlight) — all formatted/severity-classified +
state-honest, presenting numbers the Core already computes (no math here). Renderer gains **Strategy** +
**Rivals** cards; fixture-tested (474 green); compliance PASS. Tailwind/shadcn reskin still deferred.) →
~~T7.9 proactive strategy call-outs~~ (done — `strategyCalloutRule` in core turns the always-on stint
plan into spoken call-outs: edge-triggered `pit_window_open` (Tier 2) on crossing the next window's
earliest lap and `box_this_lap` (Tier 1) on the deadline, **gated by a fuel-plan confidence floor**
(docs/05 §8 "trustworthy or silent"), de-jittered by cooldown, silent in-pit / with no plan. Threaded
via a new optional `DetectionContext.strategy`; engineer-core feeds the cached emit-cadence summary so
the heavy model stays off the per-tick hot path; the radio `templatePhraser` speaks both from the
payload and `defaultVoicePriority` routes them (box→WARNING, open→STRATEGY). The dashboard already
labels them in the alerts feed. 487 green; compliance PASS. **This completes M7 / Phase-2 logic.** Live
on-rig calibration of pit windows + the replay eval set land with T1.5.). Each pure-math task is
unit-tested with doc-05 examples and validated on recorded endurance sessions (replay eval set).
Gate: Phase 2 acceptance (fuel-to-finish ±1 lap by mid-stint; pit calls match labeled set;
multi-class warnings precede encounters).
Context: [05-STRATEGY-ENGINE](05-STRATEGY-ENGINE.md).

## M8 — Proactive coaching & in-race aid advice (Roadmap Phase 3)

T8.1 read current aids → T8.2 background-strategist loop → T8.3 integrated coaching
(aid/driving ⇄ tire/fuel ⇄ strategy) → ~~T8.4 advice verification from telemetry~~ (done, pulled
forward — the **data-ready, deterministic, LLM-free** piece, the M8 analog of T9.2) → ~~T8.5
proactivity controls + quiet windows~~ (done, pulled forward — the self-contained, offline-testable
piece that closes the T6.3 proactivity-setting loop). **Read-only throughout — no write path.**
~~T8.1 read current aids — offline half done 2026-06-16~~ — a tolerant `aidsFromRest` +
`withAidsFromRest` (`packages/adapters/lmu/src/rest/aids.ts`, sharing `rest/probe.ts` with the VE
mapper) probes the REST garage payloads for TC/ABS/engine-map indices and fills only the canonical aid
fields SHM left null (prefer-SHM; brake bias stays SHM-sourced); returns nulls / unchanged state when
not found — never a guessed index (rules 1/5). 6 tests; 696 green; compliance PASS. **Live half (rig,
per [[build-rig-gated-offline-tolerant]]):** capture the garage JSON to confirm the aid-index source +
field names (docs/03 §S3); if REST lacks them, wire the S4 setup-file fallback once T9.1 lands.
~~**T8.2 background-strategist — done 2026-06-16**~~ — realised as a salience-gated event rule
`strategistRule` (`events/rules/strategist.ts`) that **produces `strategy_update`** (a declared event
type that previously had no producer): the proactive "thinking-ahead" layer that volunteers the single
most useful forward-looking line — when you've fallen off the plan's pace and must save to reach the
stop, and which resource binds (energy-save preferred when VE binds, else fuel-save). Tier-2,
deduped per headline so it speaks **on change** then is cooldown-limited (not per-lap chatter), silent
on-plan / while pitting / with no plan. **Confidence-gated** (docs/05 §8 "trustworthy or silent",
`minConfidence01` default 0.4 like the sibling `strategyCalloutRule`) so it never volunteers off a
noisy early-stint plan; carries `confidence01` in the payload for downstream hedging. Reads the
strategy engine's numbers (rule 1); the radio `templatePhraser` phrases it; proactivity gating (T8.5)
caps it downstream. 9 rule tests + a phrasing test; 706 green; compliance PASS. _Scope note:_ richer headlines (undercut windows, traffic-cost) need
the per-rival context the Core doesn't expose yet (same gap as `evaluate_undercut`) — a follow-up.
~~**T8.3 integrated coaching done 2026-06-16**~~ — the **cross-domain** layer: `integratedCoaching({
handling, fuelPlan })` in `strategy/coaching.ts` links the handling balance + tyre temps + the
fuel/energy binding into a single corrective **driving** action, and **only when domains align** (so
it adds insight, not chatter) — flagship case: understeer + energy-limited → "lift a touch earlier"
(saves energy *and* eases the front push). Pure composition of the existing deterministic reads (rule
1, no new math); read-only/advisory — coaches driving, never a setup/game change (rule 5); notes carry
the diagnosis confidence. Wired as the read-only `get_coaching` AI tool + a free template answer ("what
should I focus on?"). 5 strategy + 1 template test; 750 green; compliance PASS. **This completes M8's
offline scope.** _Follow-up:_ more links (brakes, traffic) when those reads exist; the live-audible
proactive version rides the voice layer.
Context: [06-AI-ENGINEER](06-AI-ENGINEER.md), [08-INPUT-AND-CONTROLS](08-INPUT-AND-CONTROLS.md).

**T8.4 — Advice verification from telemetry** · _Claude Code_ · deps: T0.3 (works on telemetry; live aid
values pending S3) · **done**
Build: `@race-engineer/strategy` `advice.ts` — the docs/08 §3 `AdviceVerifier`. When the engineer
recommends a bounded aid change ("you're on TC 3 — go to 5") the **driver makes it themselves**, and the
app *reads telemetry back* to confirm it. `readAidParameter(state, 'tc'|'abs'|'brakeBias'|'engineMap')`
reads the canonical aids (`player.aids.tc/abs.value`, `brakeBias.frontPct`, `engine.map`); pure
`changeSatisfied`/`classifyAdvice`; and a sticky `AdviceWatcher` that consumes the `RaceState` stream and
resolves once to **`applied`** (reached the target / moved as advised), **`unchanged`** (still at baseline
at the deadline — the driver didn't act), or **`timeout`** (moved but not as advised, or **unreadable** —
it can't confirm what it can't read). Time is the frame's `monotonicMs`, so it's a deterministic, replay-
safe function of the stream — **no wall clock, no LLM, no write path** (CLAUDE.md rule 5 — there is
intentionally no `ControlWriter`). Pure/deterministic, depends on `core` only.
Verify: ✅ worked examples (TC reached / directional bias-back / unchanged / wrong-change-timeout /
unreadable-timeout / sticky-once-resolved) + pure `changeSatisfied`/`classifyAdvice` + a property test
(only watching → a terminal status, sticky, never throws) (12 tests; 557 green); compliance PASS (rule 5 +
rule 1 audited). _Live half:_ aid **values** populate with the S3 reads (docs/03); the "good, that's it"
spoken feedback is wired by the coaching loop (T8.3) / radio layer.

**T8.5 — Proactivity controls + quiet windows** · _Claude Code_ · deps: T6.3, T5.4/T7.9 · **done**
Build: a pure gate in `radio` (`proactivity.ts`) — `shouldAnnounce(event, { level, inputs })` +
`isQuietWindow(inputs)`. The driver's **proactivity level** caps chattiness (off = only the safety
reflex; low = + urgent Tier-1; normal = + Tier-2; high = all); **quiet windows** hold non-urgent
(Tier ≥ 2) chatter under heavy braking / hard cornering (docs/07); a **Tier-0 reflex spotter call
always passes** (safety overrides everything — checked first). `radio` now owns the `ProactivityLevel`
type (settings imports it **type-only**, so the renderer pulls no radio/ai runtime; `PROACTIVITY_LEVELS`
value stays local, `satisfies`-pinned). `EngineerVoice.routeEvents` filters events through the gate
using the latest snapshot's `player.inputs`; `setProactivity` is threaded from the saved setting via
the worker `configure` message (race-safe: applied on configure and again once the voice is built).
Verify: ✅ pure-gate unit tests (level cap, quiet-window hold, **safety-always-passes even off + under
load**, custom thresholds) + EngineerVoice gating tests (496 green); electron build green (renderer
stays lean); compliance PASS (0 findings). The brake+|steer| proxy stands in for combined-g (schema
gap, docs/07). Live-audible once T10.1 lands; the setting already persists + reaches the worker today.

## M9 — Setup advisory (Roadmap Phase 4)

T9.1 read setup (read-only) (~~done — `.svm` parser, **rig-verified**~~ — the canonical reader is the
**rig T1.4** `parseSvm`/`extractSetupBaseline`/`toSetupSummary`/`parseSvmFile` in
`packages/adapters/lmu/src/setup/svm.ts` (verified against `fixtures/sample-gt3.svm`): parses the
INI-style `.svm` into a flat entry list, extracts the TC/ABS/engine-map/VE/fuel/compound **baseline**
the engineer advises from, and flattens to the canonical `SetupSummary`. _(An independent Mac-session
parser, T9.1, was reconciled away in favour of this rig-grounded one; its unused `diffSetups` was
dropped — `pnpm capture` now derives sections from the flat `entries`.)_ Read-only (rule 5 — parse to
advise relative "clicks", never write a setup); per-game format stays in the adapter (rule 4).
**Remaining:** confirm which keys map to TC/ABS/brake-bias/aero/mechanical for the advice surface, the
file location/nesting (docs/03 §S4.1), and wire the live fs read into the host.) → ~~T9.2 handling
diagnosis from telemetry~~ (done, pulled forward — it's the data-ready piece: tyre temps are already
populated, no rig needed) → T9.3 setup screen (~~view-model done 2026-06-16~~ — a pure
`buildSetupModel(snapshot)` in `apps/desktop/src/dashboard/setup-model.ts`: the **aid baseline** the
engineer advises from (TC/ABS with their schema range; brake bias %, engine map) + the **loaded setup
params** grouped by `.svm` section (from T9.1). State-honest — unread aids `—`, and per-setting
mechanical/aero **safe ranges** stay `—` until the rig provides the car data (docs/03 §S4.2); the model
carries the structure so the screen renders them the moment they land. 7 tests; 722 green; compliance
PASS. _Remaining:_ the dedicated screen UI lands with the deferred Tailwind/shadcn reskin; safe-range
values come from the rig.) → T9.4 AI recommendations (~~`propose_setup_change` done 2026-06-16~~ —
`proposeSetupChanges(diagnosis)` in `strategy/setup-advice.ts` maps the handling diagnosis (T9.2) to
ordered **directional, relative** advice (balance → "soften the front bar a click or two", then
per-corner tyre-pressure + camber), each with a reason + the diagnosis confidence. Wired as the
read-only `propose_setup_change` AI tool + a free template answer ("how do I fix the understeer?").
**Advice only — the driver applies it in the garage; the app never writes a setup** (rule 5); relative,
never a fabricated absolute (rule 1). 7 strategy + 1 tool + 2 template tests; 732 green; compliance
PASS.) → ~~T9.5 before/after compare done 2026-06-16~~ — `compareHandling(before, after)` in
`strategy/setup-compare.ts` closes the advise→apply→verify loop: after the driver applies a change in
the garage, it compares the handling diagnosis before vs after and reports whether the balance
`improved` / `unchanged` / `worsened` (judged from the front−rear temp-gap magnitude; a flip to a
smaller gap reads as improved, an overcorrection to a bigger gap as worse), with a driver-facing
summary. The *what changed* half is the `.svm` delta (`diffSetups`, T9.1); this is the *did-it-help*
half. Pure (reads two diagnoses), read-only/advisory — evaluates the driver's change, never makes one.
6 tests; 738 green; compliance PASS. **This completes M9's offline scope** (live setup values + the
dedicated screen UI remain — rig + the deferred reskin).

**T9.2 — Handling diagnosis from telemetry** · _Claude Code_ · deps: T0.3 (works on telemetry) · **done**
Build: `diagnoseHandling(tires, thresholds?)` in `@race-engineer/strategy` `handling.ts` — the
docs/08 §3 directional reads from the canonical tyre temps: per-corner **camber** (inner-vs-outer
spread), **pressure** (centre-vs-edges; centre hot ⇒ over-inflated), and axle **balance** (front-avg
vs rear-avg ⇒ understeer/oversteer tendency). Directions are conventional tyre theory; magnitude
thresholds are rig-tunable options. State-honest: single-value temps ⇒ `unknown`, `confidence01` =
fraction of corners with 3-zone data (docs/05 §8). Pure/deterministic, depends on `core` only — the
deterministic analysis the LLM *phrases* (backs the docs/06 `get_handling_diagnosis` tool).
Verify: ✅ worked-example (camber/pressure/balance) + state-honesty + property (no NaN, confidence
∈[0,1], sign-symmetric camber) tests (505 green); compliance PASS. **Wired into the AI surface:** the
read-only `get_handling_diagnosis` tool (`ai/tools.ts` — runs the diagnosis from the snapshot tyres;
`ai` now depends on `strategy` at runtime, acyclic) + a free template-mode handling answer (quotes the
front/rear temps + balance tendency); 507 green. ~~Dashboard "Handling" card done 2026-06-16~~ — a
pure `buildHandlingModel(snapshot)` in `apps/desktop/src/dashboard/handling-model.ts` (mirrors the
strategy-model pattern): display-ready axle balance (understeer/oversteer → caution, neutral → good),
front/rear temps + signed delta, per-corner camber/pressure hints, and a zone-data confidence;
state-honest (single-value temps → `—`/unknown). Wired into the renderer as a **Handling** card
(hidden when no read is possible). 7 model tests; 682 green; electron build green; compliance PASS.
_Remaining follow-up:_ magnitude thresholds calibrated on the rig.
Context: [08-INPUT-AND-CONTROLS](08-INPUT-AND-CONTROLS.md) §3, [09-UI-UX](09-UI-UX.md).

## M10 — Polish, local mode, packaging (Roadmap Phase 5)

T10.1 wire local STT/TTS (Piper/Kokoro + faster-whisper) + cost estimator → T10.2 full
onboarding (profile choice + model download/GPU detect + mic permission + plugin-install
helper + health UI, per [16](16-PLATFORM-PREREQUISITES.md) §5) (~~health/readiness model done
2026-06-16~~ — a pure `buildReadinessReport` in `apps/desktop/src/readiness.ts`: the model behind the
onboarding/health screen + "ready to race?" badge. From the config + injected capability probes it
emits a per-concern check list (profile / LLM / TTS / STT / mic / output / PTT / source), each with a
status (ready/attention/blocked) and the **next action** to fix it — e.g. a cloud route with no key is
`blocked` with "Add your … key", an unreachable Ollama is `attention` (template still works), an LMU
source with no telemetry nudges "Start LMU". `overall` = worst status; `blockers` = the fix-first list.
Pure/input-injected, secret-safe (presence booleans only, rule 6), 10 tests; 675 green; compliance
PASS. _Remaining T10.2:_ the live capability probes (GPU/VRAM, model download/verify, mic-permission +
device test, plugin-install helper) + the renderer wiring — native/runtime, verified live) →
T10.3 crash isolation,
graceful degradation, **local diagnostics export** (~~diagnostics export done 2026-06-16~~ — a pure,
secret-safe `buildDiagnosticsReport` in `apps/desktop/src/diagnostics.ts`: a redacted bug-report
snapshot — app/version, platform, configured providers, source/health, recent event counts, and recent
**scrubbed** errors. **No secrets ever** (rule 6): keys are reported as presence booleans, never values;
errors pass through `redactSecrets`; device/PTT hardware ids reduce to booleans. Pure/input-injected,
10 tests incl. a planted-key-never-survives check; 665 green; compliance PASS. _Remaining T10.3:_ the
crash-isolation/auto-restart wiring + graceful-degradation surfacing in the Electron shell, and wiring
the diagnostics export to a "Save report" button + a real version/platform/health collector — runtime
pieces best verified live) → ~~T10.4 eval suites (latency + accuracy) in
CI on recordings~~ (done — new **`@race-engineer/eval`** package + `pnpm eval` CLI. Three pure,
deterministic eval suites that score the **same always-on machinery the app runs** against ground
truth derived from the data itself: (a) **fuel accuracy** — replays a `RaceState` stream through
the live `StrategyEngine` and, at each lap boundary, compares its estimate to the recording's own
measured per-lap burn; the docs/10 Phase-2 gate is *within ±1 lap by mid-stint* (passes on a clean
synthetic stint, converges from a wrong-early start on a noisy one, fails a non-converged stint, and
stays **silent** — no fabricated rate — on a flat-fuel slice, docs/05 §8); (b) **event correctness**
— runs `EventDetector` + `defaultEventRules` over the stream and checks one `lap_completed` per lap
boundary, schema/NaN well-formedness, and no event storm; (c) **latency** — drives the real
`ReactiveRadioLoop` over scripted turns with an injected clock and gates Tier-2 first-audio p95 vs
the docs/01 budget (reuses radio's `LatencyAggregator`). `pnpm eval <synthetic|replay <file>>` prints
the report; the suites run in CI as tests (`packages/eval/src/__tests__`). Pure/read-only, no key,
no network — the math is reused from `@race-engineer/strategy`/`core`, the eval only measures (rule
1). 11 tests, 573 green; compliance PASS. **Real-data accuracy is rig-gated:** both committed
recordings are flat-fuel slices, so the fuel-accuracy *numbers* run today only on synthetic
ground-truth — the headline "±1 lap by mid-stint **on a recorded endurance race**" gate needs a
**multi-lap rig recording with real fuel burn** (rig backlog, docs/03; `pnpm eval replay <stint>`
scores it the day it lands)) → T10.5 electron-builder installer + auto-update (GitHub Releases) +
**code signing (SignPath Foundation, free for OSS)** + `THIRD-PARTY`/`NOTICE`.
Gate: clean install on a fresh Windows PC; guided first-run to a working radio exchange;
multi-hour race unattended; documented cloud cost/hour + working free local mode.

## M11 — Virtual Energy (LMU binding constraint) · _correctness fix, user-flagged_

The fuel/strategy engine originally modelled consumption in **litres only**. In LMU a stint
is frequently bound by the per-stint **Virtual Energy** budget, not fuel — a car can have
litres left but be out of VE. Planning on litres alone is wrong for LMU. This makes VE a
first-class quantity parallel to fuel, so the binding stint/finish constraint is
`min(fuel-limited laps, VE-limited laps)`. Context: [05-STRATEGY-ENGINE](05-STRATEGY-ENGINE.md)
§"Virtual Energy", [03-LMU-INTEGRATION](03-LMU-INTEGRATION.md) §VE / `/rest/strategy/usage`.

**T11.1 — VE in the canonical schema + strategy math** · _Claude Code_ · deps: T3.1 · **done**
Build: ✅ `PlayerCar.virtualEnergy` (`{ level01, perLapAvg01, lapsRemainingEst } | null`,
`.default(null)` so pre-VE / SHM-only recordings still validate) + `FuelPlan` VE fields
(`perLapEnergy01`, `lapsRemainingOnEnergy`, `energyToFinish01`, `energyToAddNextStop01`,
`energySaveTargetPerLap01`, `bindingConstraint`). `strategy/fuel.ts`: `estimatePerLapEnergy` +
`energyDeltasFromReadings01` (the fuel estimator refactored to a shared `blendConsumption`, so
fuel and VE share identical robust-median + prior-blend math), and `computeFuelPlan` extended
with an optional `energy` input that computes the VE-limited laps and sets `bindingConstraint`
to whichever resource runs out first. Pure/deterministic; VE all-null when not supplied (fuel
planning unchanged). The LMU SHM normalizer sets `virtualEnergy: null` (VE is REST-only).
Verify: ✅ worked examples (fuel-binds / VE-binds / VE-to-finish / VE-save / VE-absent /
unknown-rate) + property (VE-laps monotone in level; finite; schema-valid; binding ∈ {fuel,
energy}) tests; typecheck + lint + 625 green; compliance PASS.
**T11.2 — VE through the live engine + dashboard** · _Claude Code_ · deps: T11.1 · **done**
Build: ✅ the synthetic source emits a VE arc (`startEnergy01`/`energyPerLap01`, optional → null
when omitted; default + scripted configs tuned so VE is the binding constraint); `engineer-core`'s
`StrategyEngine` accumulates green-lap VE deltas exactly like fuel (refill-/caution-/restart-safe)
and passes `energy` into `computeFuelPlan`; the dashboard view-models surface VE (`model.ts` energy
block + `binding`; `strategy-model.ts` `binding` + VE-save target) and the renderer paints a
**Virtual Energy** card (hidden for fuel-only streams) with an **"Energy-limited"/"Fuel-limited"**
badge on whichever resource binds. State-honest: VE absent → all `unknown`, `binding` null.
Verify: ✅ engine VE-learning/binding/refill-drop tests, synthetic VE-arc + omitted-VE tests,
dashboard energy-block + binding + VE-save tests; typecheck + lint + 634 green; electron build green;
compliance PASS. _Live half:_ real VE values arrive with T11.3 (LMU REST); the renderer card +
"energy-limited" call are then visible against the live source.
**T11.3 — VE from LMU REST → canonical** · _Claude Code (live verify human-assisted)_ · deps: T11.1, T2.2 · **offline half done**
Build: ✅ a **tolerant** REST→canonical mapper `virtualEnergyFromRest(strategyUsage, repairRefuel)`
+ `withVirtualEnergyFromRest(state, rest)` in `packages/adapters/lmu/src/rest/virtual-energy.ts`:
probes documented candidate keys (case-insensitive, one level of nesting), normalizes a % (0..100)
**or** a 0..1 fraction to the canonical 0..1, computes `lapsRemainingEst`, and **returns null when no
VE level is found** — never invents one (rule 1 / state-honesty). VE is REST-only (absent from rF2
SHM), so this is its sole source; read-only (only reads payloads the GET-only client fetched).
Verify: ✅ mocked-payload mapping tests (%/fraction/nested/fallback/clamp/absent/zero-rate) + merge-
into-`RaceState` tests; typecheck + lint + 650 green; compliance PASS.
**Live wiring done 2026-06-16** (~~the ~2 Hz REST poll into `lmu-host.ts` off the SHM hot path~~):
new `apps/desktop/src/lmu-rest.ts` `createRestMerge` polls the GET-only `LmuRestClient` for
`strategyUsage`/`garage`/`repairRefuel` on **its own ~2 Hz timer** and exposes a pure `merge(state)`
that applies `withVirtualEnergyFromRest` + `withAidsFromRest` against the **last** snapshot — so the
50 Hz SHM tick does no network I/O and only spreads when REST actually has data (returns the same ref
otherwise). `lmu-host.ts` wraps the SHM normalizer with it (VE/aids land before the strategy engine +
detector run) and drives the poll from `start()`/`stop()`; degrades to a null client when the runtime
has no `fetch`, and the poll never throws. 4 tests (798 green); typecheck + lint + compliance PASS
(rules 5/3/4 + state-honesty). **Still human-assisted (rig):** with LMU in a session, capture the real
`/rest/strategy/usage` + `RepairAndRefuel`/`getPlayerGarageData` JSON to **pin the LIVE-VERIFY field
names** (`LEVEL_KEYS`/`PER_LAP_KEYS` in virtual-energy.ts, the aid-index keys in aids.ts) and confirm
VE/aids actually populate against the live source — the mappers fail safe (null) until then. Full
checklist in [03-LMU-INTEGRATION.md](03-LMU-INTEGRATION.md) §C (Virtual Energy).

**T11.5 — Proactive `energy_low` call-out** · _Claude Code_ · deps: T11.1, T11.2 · **done**
Build: ✅ the Virtual-Energy sibling of `fuel_low` (T5.4) — a new `energy_low` `EventType`, an
`energyLowRule` (`packages/core/src/events/rules/energy-low.ts`) that fires off the canonical
`player.virtualEnergy.lapsRemainingEst` at escalating laps-left thresholds (default 4 → 2) with the
framework cooldown, silent when VE is absent/unknown. Wired into `defaultEventRules`; the radio
`templatePhraser` speaks it ("Energy's low — about N laps." / "Energy critical — box this lap.") and
`defaultVoicePriority` routes it by urgency (≤2 laps → WARNING, else STRATEGY), exactly like fuel;
the dashboard labels it "Energy low" in the alerts feed. Pure detection, no math, no write path.
Verify: ✅ rule tests (one-shot arc / silent-when-no-VE / multi-threshold escalation) + radio
phrasing + priority tests; typecheck + lint + 655 green; compliance PASS.
**T11.4 — VE in the AI tool surface + template answers** · _Claude Code_ · deps: T11.1 · **done**
Build: ✅ `get_fuel_plan` now returns the binding constraint + a `virtualEnergy` block as
**percentages** (the LMU convention, so the LLM/guard quote figures directly, not raw 0..1), null
for fuel-only series; `get_race_state` gains a VE % summary; both descriptions updated. A new
**Virtual Energy template intent** (free/no-LLM) answers "how's my energy" with VE laps + %/lap +
which resource binds, and the **fuel answer is now VE-aware** — when energy is the tighter limit it
says so (the user-flagged gap). System prompt gained a VE/binding-constraint line (phrasing only;
the LLM still gets every number from a tool — rule 1). State-honest: VE absent → "no reading yet",
never a fabricated %.
Verify: ✅ tool tests (VE % block + binding on `get_fuel_plan`/`get_race_state`, null for fuel-only)
+ template tests (energy intent, VE-aware fuel answer, VE-absent honesty); typecheck + lint + 641
green; compliance PASS. _Follow-up:_ proactive VE-low call-out rule (sibling of `fuelLowRule`),
confidence-gated, is a separate small task; live VE values arrive with T11.3.

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
