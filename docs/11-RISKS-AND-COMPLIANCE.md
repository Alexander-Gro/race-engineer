# 11 — Risks & Compliance

A consolidated risk register with mitigations. The compliance section comes first because
it defines the project's fundamental posture.

## Compliance: Race Engineer is read-only and advisory

Race Engineer **never writes to the game**. It does not inject input, does not change any
setting or driver aid, and does not automate driving. Its only outputs are **its voice and
the on-screen dashboard**. The driver makes every change to the car themselves.

This single decision removes the entire category of anti-cheat / fair-play risk that
surrounds automated input tools. The app does exactly what a human race engineer on a
radio does: observe sanctioned data and give advice.

### What the app reads (all sanctioned / low-risk)
- **Shared memory** via the **rF2 Shared Memory Map plugin** — a documented, widely-used
  telemetry interface (the same one CrewChief, SimHub, etc. rely on). Standard, accepted
  practice in the sim-racing community.
- **Local REST API** — read-only. Unofficial (reverse-engineered), so the risk here is
  *fragility across game updates*, not fair-play.
- **Setup files** — opened **read-only** to know the current setup. The app never writes
  setup files, so there is no risk of corrupting a user's saved setups.

### Things we still do carefully
- **Terms of Service:** review LMU / Studio 397 / Motorsport Games terms. A read-only
  telemetry consumer is consistent with established community tooling, but confirm.
- **No misleading advice:** the engineer's value depends on being right. Advice that
  affects results (pit calls, fuel targets) must be grounded in tool data with confidence
  ("trustworthy or silent" — see [05](05-STRATEGY-ENGINE.md), [06](06-AI-ENGINEER.md)).
- **Privacy:** microphone capture and transcripts (see below).
- **If write-back is ever requested in future**, it would be a separate, explicitly
  approved feature with its own compliance review and an off-by-default, opt-in gate — not
  a quiet addition. Today there is no write path in the architecture.

## Open-source distribution & cost safety

Race Engineer is published on GitHub as a client-side desktop app. The publisher must never
incur inference cost, and a user must never be surprised by one. Full design in
[15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md). Hard rules:

- **No embedded secrets, ever.** No API key in the repo, build artifacts, or logs. Public
  keys are scraped and drained within minutes — this is the classic OSS surprise-bill
  disaster. Enable CI secret-scanning to block accidental commits.
- **No central server / proxy.** The app calls providers directly from the user's machine
  using the user's own configuration. There is no hosted component the publisher pays for.
- **Bring-your-own-key only.** Cloud providers are opt-in; the user enters their own key,
  stored only in OS secure storage. The app never holds a billable credential.
- **Free local profile ships enabled**, plus a template-only fallback, so the app is fully
  usable at $0 with no key and no internet — and is not *dependent* on any cloud free tier
  that could change or disappear.

## Risk register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Shared-memory plugin incompatible with current LMU build / fields not populated | Med | High | Spike S1 before building; `capabilities()` degrades gracefully; cross-check via REST; pin tested plugin version + guide users |
| R2 | LMU REST API undocumented and changes between builds | High | Med | Treat as unofficial; isolate in adapter; cache; feature-detect; fall back to shared memory |
| R3 | Current TC/ABS/brake-bias values not readable (so advice can't reference exact baseline) | Med | Med | Spike S3; read from setup file if not in telemetry; or ask the driver to confirm the baseline once, then track relative advice |
| R4 | Advice quality / wrong strategy or setup call erodes trust | Med | High | LLM never does math (tools only); confidence-gated proactivity; hallucination guard test; "trustworthy or silent"; before/after verification |
| R5 | Voice latency too high to feel like a real engineer | Med | High | Tiered audio; pre-rendered spotter; sentence-streamed TTS; provider latency benchmarks; local mode |
| R6 | LLM hallucinates numbers | Med | High | LLM never computes; every spoken number must come from a tool result that turn (automated guard) |
| R7 | Cloud AI/voice cost too high for multi-hour races | Med | Med | Fast-model default + caching; per-session budget cap; local STT/TTS mode; cost-per-hour estimator |
| R8 | Electron footprint hurts sim performance | Med | Med | Hot loop in worker; throttled UI; minimal-overlay mode; Tauri escape hatch (pure core/strategy ports cleanly) |
| R9 | Setup file parsing breaks across game updates | Med | Low | Read-only (no corruption possible); defensive parsing; feature-detect; treat format as unofficial; REST alternative if available |
| R10 | Torn/stale shared-memory reads | High | Med | Version-counter guard (begin/end) on every read; skip torn frames; detect game-not-running |
| R11 | Wheel input detection misses certain devices (PTT) | Med | Med | SDL2 broad coverage; Raw Input/DirectInput fallback; manual device/button entry |
| R12 | Privacy: mic audio + transcripts leave the machine | Med | Med | PTT-only capture (no always-listening); local mode; clear data handling; no audio retention by default |
| R13 | Overlay won't draw over exclusive-fullscreen | High | Low | Recommend borderless windowed; document; second-monitor dashboard always works |
| R14 | Single-developer bandwidth vs broad scope | High | Med | Strict phasing; vertical slices; replay harness to develop without the game running |
| R15 | Surprise API bill for the OSS publisher | Low | High | No embedded keys; no central server/proxy; bring-your-own-key only; free local profile is the default; CI secret-scanning. See §Open-source distribution & cost safety |
| R16 | Cloud free tier changes/removes its quota | Med | Low | Default profile doesn't depend on any cloud free tier (local + template mode); provider fallback chain; quotas documented as indicative only |
| R17 | Antivirus / SmartScreen flags the app (reads game memory, captures mic, native binaries) | Med | Med | Code-sign (SignPath Foundation, free for OSS); build reputation; submit false-positive reports; document expected first-run warnings ([16-PLATFORM-PREREQUISITES.md](16-PLATFORM-PREREQUISITES.md)) |
| R18 | Microphone permission denied / no mic | Med | Med | Detect failure, deep-link to Windows mic settings, text-input fallback; never crash |
| R19 | Local-model download/runtime missing (Ollama, CUDA, model files) | Med | Med | Detect at onboarding; CPU fallback for STT; offer free cloud-tier or template mode if local LLM unavailable; offline bundle option |

Note how much smaller the risk surface is than for a tool that writes to the game: there
is no anti-cheat-flag risk, no setup-corruption risk, and no input-injection failure mode,
because the app never does any of those things.

## Privacy & data handling

- **Microphone:** captured **only while PTT is held**. No background/always-on listening.
- **Transcripts & audio:** stored locally by default; cloud STT/TTS sends only the
  PTT-window audio / reply text to the chosen provider. Make providers and retention
  explicit in settings; offer local-only mode for zero cloud audio.
- **API keys:** stored via OS secure storage (DPAPI through Electron safeStorage); never
  written to logs or the repo.
- **Telemetry/session data:** local SQLite; any future community data-sharing of fuel/
  tire priors is strictly opt-in and anonymized.

## Operational safety

- **Graceful degradation:** any provider/integration failure falls back (templated audio,
  on-screen text) without stalling the telemetry loop.
- **Crash isolation:** voice/LLM failures must not crash telemetry or UI.
- **Health surfacing:** plugin status, REST connection, provider reachability, and budget
  usage are visible in settings so failures are diagnosable.
- **Don't distract the driver:** quiet windows during high-load moments; urgent-only
  override; proactivity level configurable down to near-silent.
