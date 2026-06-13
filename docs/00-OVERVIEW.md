# 00 — Product Overview

## Vision

A race engineer in your ear. Race Engineer turns the data a sim already produces into
the kind of help a real endurance team gives its driver: calm strategic guidance, sharp
situational awareness, and a setup partner who understands what the car is doing. You
talk to it like a real engineer over the radio; it talks back in a natural voice.

The differentiator is not "another dashboard." It is **judgment**: knowing *when* to
pit, *how much* to lift-and-coast, *whether* an undercut works, and *what* setup change
addresses the handling complaint you just described — delivered conversationally, at the
right moment, without you taking your hands off the wheel.

## Who it is for

| Persona | Needs | How Race Engineer helps |
| --- | --- | --- |
| **Endurance enthusiast** (the primary user) | Manage multi-hour races solo, hit fuel/tire targets, not get lost in traffic | Live strategy, fuel-save coaching, pit calls, multi-class spotting |
| **Competitive racer** | Marginal gains, undercut/overcut decisions, consistent stints | Rival-relative strategy, gap math, stint pace targets |
| **Setup tinkerer** | Translate "the car feels X" into setup changes | Practice-mode tuning assistant grounded in telemetry |
| **Casual/learning driver** | Understand what fuel/TC/brake bias even do | Plain-language coaching and explanations |

## Core capabilities (product pillars)

1. **Read the car & the race.** Fuel, per-wheel tire temps/pressures/wear, brake temps,
   TC/ABS/brake-bias/engine-map, lap and sector times, track position, gaps, flags,
   and the positions of other cars (including class in multi-class racing).
2. **Talk.** A push-to-talk radio (mapped to a wheel button) lets the driver ask
   questions and issue commands by voice. The engineer answers in a natural AI voice and
   makes proactive call-outs.
3. **Strategize (endurance core).** Fuel and stint planning, pit windows, undercut/
   overcut, fuel-save targets, tire-degradation modeling, safety-car opportunism, and
   mandatory-stop / driver-change rules.
4. **Advise on tuning.** Knowing the car's full setup and current aids, the engineer tells
   the driver exactly what to change — a full setup assistant in practice, and precise
   in-race aid guidance ("brake bias back two for rotation"). The app never changes the
   car itself; the driver makes every change.
5. **Spot.** Proactive awareness: cars alongside, closing rates, faster-class traffic,
   blue flags, pit-window reminders.

## Why Le Mans Ultimate first

- **Endurance is its identity.** LMU is built around multi-class endurance racing
  (Hypercar / LMP2 / GTE-GT3). Strategy and multi-class traffic management — the
  hardest, most valuable engineering problems — are exactly where LMU lives.
- **Known telemetry path.** LMU runs on the rFactor 2 (gMotor) engine, which has a
  mature, sanctioned shared-memory telemetry interface and an existing open-source
  reference (CrewChief supports LMU). This de-risks the integration.
- **Underserved.** The endurance-strategy + voice-engineer combination is not well
  covered by existing free tools for LMU specifically.

## What "done" looks like for v1 (MVP)

The MVP is a **single vertical slice that talks**:

- Connects to a running LMU session and shows a live dashboard (fuel, tires, brakes,
  TC/ABS/brake-bias, position, gaps, last/best lap).
- Push-to-talk on a mapped wheel button: ask "how's my fuel?" / "what's my last lap?"
  / "who's behind me?" and get a correct spoken answer in < ~2 s.
- Deterministic fuel calculation: laps remaining on current fuel, and laps-to-finish
  delta, spoken on request and proactively when fuel runs low.
- Basic spotter call-out for a car alongside (templated audio, sub-300 ms).

Everything beyond that (full strategy optimizer, setup tuning, multi-game) is roadmap.
See [10-ROADMAP.md](10-ROADMAP.md).

## Explicit non-goals (for now)

- **No changing the car for you (read-only/advisory).** Race Engineer never writes to the
  game — it never steers/brakes/throttles, and it never changes settings or driver aids
  itself. It tells you exactly what to change; you make every change. See
  [11-RISKS-AND-COMPLIANCE.md](11-RISKS-AND-COMPLIANCE.md).
- **No cheating or hidden-information advantage.** It surfaces only what the game
  exposes through sanctioned interfaces.
- **No mobile/console.** PC (Windows) only — that is where the sims and their telemetry
  interfaces are.
- **No multi-game support in v1.** The architecture is multi-game-ready (adapter
  pattern), but only LMU is implemented first.

## Success metrics

- **Latency:** spotter call-outs < 300 ms; conversational answers < 2 s to first audio.
- **Accuracy:** fuel-to-finish estimate within ±1 lap by mid-stint; pit-call timing
  agrees with a human strategist on replayed races.
- **Trust:** the driver acts on the engineer's calls without double-checking a screen.
- **Cost:** a full-length online endurance race is affordable on cloud AI, or free in
  local/offline mode.

## Guiding principles

- **Right info, right moment, hands on the wheel.** Voice-first; the screen is backup.
- **Deterministic where it matters.** Math is code; the LLM provides language and
  judgment framing, not arithmetic.
- **Trustworthy or silent.** A wrong fuel call is worse than no call. Quantify
  uncertainty and degrade gracefully.
- **Game-agnostic core.** Only the adapter knows it is talking to LMU.
- **Free and open.** Free to run and free to publish: a client-side desktop app that ships
  a $0 local profile (no key, offline-capable), with cloud providers opt-in and
  bring-your-own-key. The publisher never incurs inference cost. See
  [15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md).
