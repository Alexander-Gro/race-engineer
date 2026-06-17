# 06 — AI Engineer (LLM design)

The AI Engineer is the conversational brain. It is built on **Anthropic Claude** via the
official TypeScript SDK, using **tool use** to read live state and strategy. It provides
**language and judgment framing** — never arithmetic. Every engineer utterance (proactive
call-outs *and* answers) is generated here from the live data.

## Hard rules

1. **No math in the model.** All numbers come from tool calls into the Strategy Engine
   ([05](05-STRATEGY-ENGINE.md)) and `RaceState` ([04](04-DATA-MODEL.md)). The model may
   compare and explain, but the authoritative figures are the tool outputs.
2. **The LLM voices everything.** **Every tier (1–3) is LLM-generated from data, by default** —
   proactive strategy call-outs *and* driver answers. Template phrasing is a **degraded fallback
   only** (no model / cost cap / offline), never the default voice.
3. **Bounded and honest.** The model is instructed to defer to tool data, to hedge when
   `confidence01` is low, and to say "I don't have that" rather than invent.
4. **Cheap by default.** Endurance races are long; token/character budgets and model
   tiering keep cost sane (see §Cost).

## Two operating modes

### Reactive (driver radio) — Tier 2
```
PTT held → mic capture → STT (streaming) → partial transcript
PTT released → final transcript → Claude(messages + read-only tools, streaming)
   → as soon as first sentence streams, begin TTS (barge-in friendly)
   → the answer may be advice (e.g. "move brake bias back two clicks"); the driver makes
      the change, and the app can verify from telemetry that it was applied
```
Target: **< 2 s to first audio.** Use a fast model and stream both the LLM and TTS so
the driver hears the first words while the rest generates.

### Proactive (engineer call-outs) — Tier 1/2/3
The Event Detector emits strategy-class events. For these the LLM produces a short, natural call-out
by reasoning over the live data — through the **same tool-driven brain as the Q&A path**, so a flagged
event is a *candidate moment*, not a phrase to recite:
```
event {type: tire_temp_out_of_window, payload:{direction:'cold'}}  // a monitor flag, not a script
   → runProactiveTurn (engineer prompt + skill + read-only tools)
   → engineer reads phase/lap/tyre/handling/fuel via tools, reasons about the cause
   → one short call-out  (or SILENT — judged not worth a word)  → TTS queue
```
Implementation: `runProactiveTurn` (`packages/ai/src/proactive.ts`) reuses `runRadioTurn`'s tool loop;
`engineerPhraser` (`packages/radio`) is the `ProactivePhraser` the `ProactiveVoiceRouter` calls, and
`EngineerVoice` defaults to it whenever a provider is configured. Because the engineer pulls every
number from the audited read-only tools, "the LLM never computes numbers" holds by construction.

Latency budget is looser (Tier 1–3), so these are **LLM-generated from the live data every time** —
that is the product: an engineer reasoning about *this* moment (cold tyres on the formation lap → "they
'll be cold for the start, ease in") not reading a fixed phrase book. Template phrasing exists **only as
a degraded fallback** when no model is available (no key / no local model / cost cap / offline); it is
not the default. A line the driver hears that the LLM didn't generate means the AI engineer isn't
running — a bug, not the design.

**Background strategist (always on).** The Strategy Engine recomputes every tick, so the
engineer is *continuously* watching for opportunities, not just answering questions. When
a confident, material opportunity appears — an undercut/overcut window opening, an FCY
worth reacting to, a fuel-save that unlocks a strategy, a tire/aid tweak that changes the
stint — it proactively keys the radio (subject to confidence gating and quiet windows so
it never natters mid-corner). The driver can dial proactivity from "chatty" to "only when
it matters" to "silent unless I ask."

## The engineer skill (reasoning playbook)

The system prompt below is the *persona and hard rules*. On top of it sits the **engineer skill** —
a per-domain reasoning playbook that is the difference between an engineer and a phrase book. It does
not say *what to say*; it says *how a real engineer reads each kind of data, decides whether it's
worth the radio at all, and phrases it*. Lives in `packages/ai/src/skill.ts` (`ENGINEER_SKILL`),
composed into every system prompt by `buildSystemPrompt` and prompt-cached with it.

It encodes the judgment the old rules-engine lacked — the reasons behind a call, not a threshold:

- **How it sounds — real radio, not a report.** The output is read aloud by TTS, so it's **plain
  spoken words only: no markdown, asterisks, bullet lists, or headings** (a hard rule in
  `BASE_SYSTEM_PROMPT`, belt-and-braces stripped by `stripSpokenFormatting` in `@race-engineer/voice`
  so a leaky local model can never voice a "*"). And it's **terse** — grounded in real F1/WEC team
  radio, where a call is a handful of words ("Box, box.", "Save the tyres, Turn 4."): one or two
  short sentences and stop, *even when asked*, leading with the instruction or the one number, the
  rest only if the driver asks. This is the fix to "the answers are too in-depth."
- **When to speak at all.** Speak only when it needs an action, changes a decision, or is something
  the driver can't see/feel himself. Otherwise stay silent — a quiet engineer is trusted, a chatty
  one gets muted.
- **Memory / don't repeat.** The driver remembers what you told him. Never re-raise a settled thing;
  only speak again if it crossed into a new, worse band. (This is the *judgment-layer* answer to the
  "it told me already" complaint.)
- **One idea per call; timing beats completeness.** Don't stack domains; don't talk into a corner.
- **Per domain** — tyres (window + trend, not absolute temps), fuel/**Virtual Energy** (the binding
  constraint), strategy/pit windows (confident + material only), anticipatory traffic (a faster class
  closing or a blue flag — *not* split-second proximity), pace (patterns, not raw lap times),
  aids/setup (directional advice, never a write).

The skill changes none of the hard rules: numbers still come only from tools (rule 1), and the
engineer never writes to the game (rule 5). It adds *relevance, timing, memory, and brevity*.

## How a call is decided (hybrid trigger model)

The deterministic layer and the AI split the work — neither does the other's job:

```
hot path (TS, per tick)            engineer (AI, at flagged moments)
─────────────────────              ─────────────────────────────────
Event Detector rules               buildSystemPrompt() = persona + rules + ENGINEER_SKILL
  detect a *candidate moment*  ──►  receives the FULL race-state digest (not just the trigger fact)
  + compute all the numbers          → reasons across domains with the skill
  (tyre Δ, fuel/VE, gaps, deg)        → decides: speak once, or stay silent
                                       → phrases it from the tool numbers → TTS
```

- **Rules are triggers, not phrasing.** A rule like `tire_temp_out_of_window` no longer *is* the
  call-out "tyres too hot" — it flags that this moment is worth the engineer's attention and hands
  over the computed facts. The AI owns whether it's worth voicing and how to say it.
- **Full digest at the flagged moment** (the chosen model — see the build plan), so the engineer can
  connect tyres → energy → strategy rather than reacting to one isolated fact. This keeps the hot
  path clean and token cost bounded (the AI wakes on candidates, it doesn't poll every tick) while
  still giving it the whole picture when it does speak.
- **Traffic is anticipatory only** — a faster class closing, a blue flag, a slower car ahead in a
  braking zone. There is **no** instant "car alongside" proximity call; that split-second awareness is
  the driver's own eyes and mirrors.
- **Latency nuance.** A real engineer takes a beat — so the budget for engineer-class calls (tyres,
  fuel, strategy, anticipatory traffic) is the Tier-1–3 budget. The reasoning *is* the product; a
  1–2 s considered call beats an instant canned one.

## Model tiering

| Use | Model | Why |
| --- | --- | --- |
| Radio replies, short proactive call-outs | **fast Claude model** (e.g. Haiku-class) | snappy, cheap, good enough with tools doing the reasoning |
| Deliberative strategy ("plan my whole race", "explain the undercut tradeoff") | **larger Claude model** (e.g. Sonnet/Opus-class) | better multi-step judgment |
| Setup analysis from feedback + telemetry | **larger model** | nuanced reasoning over many signals |

Selection is automatic: classify the request (length/intent/tooling depth) and route.
Always confirm exact current model IDs against the Claude API docs before pinning;
defaults should track the latest fast and capable Claude models.

**Provider is swappable; the default is free.** The model tiers above describe the *optional*
premium (Claude) profile. Because the strategy engine does all the math and the tool surface
is simple read-only getters, a free or modest model suffices. The shipped **free profile**
uses, in order of preference: a **free cloud tier** (the user's own Groq / Gemini / OpenRouter
account — zero local GPU load), a **local model** (Qwen 3.x via Ollama — best when a 24 GB+
GPU or a second machine is available), or **template mode** (no LLM at all; structured queries
answered directly from the strategy engine — the always-available offline fallback). All sit
behind one LLM-provider interface; cloud providers are bring-your-own-key. See
[15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md).

## Context strategy

Sending raw 60 Hz telemetry to the LLM is wasteful and slow. Instead:

- Maintain a compact, continuously-updated **race-state briefing** (a few hundred tokens):
  position, gaps to car ahead/behind (+class), fuel plan summary, tire status, last/best
  lap, flags, laps/time remaining, next pit window. Refreshed each tick, snapshotted at
  query time.
- Keep a **short rolling dialogue history** (the last few radio exchanges).
- Everything precise/fresh is fetched via **tools**, not stuffed into context.
- Use **prompt caching** for the stable system prompt + persona + tool schema to cut
  cost and latency on repeated calls.

## Tools (function calling)

**All tools are read-only.** There is no tool that writes to the game.
```
get_race_state()        → compact RaceState briefing
get_rivals()            → cars ahead/behind with class, gap, closing rate
get_fuel_plan()         → FuelPlan (05): fuel + Virtual Energy (LMU, as %) + bindingConstraint
get_stint_plan()        → StintPlan (05)
project_pit_window()    → pit window + recommendation
evaluate_undercut(id)   → undercut/overcut recommendation
get_tire_status()       → per-wheel temps/wear/window + deg estimate
get_current_aids()      → current TC/ABS/brake-bias/engine-map (the advice baseline)
get_setup_summary()     → current setup params (read-only)
get_handling_diagnosis()→ understeer/oversteer balance, tire-temp spread, bottoming, lockups
propose_setup_change()  → directional, relative setup advice from the diagnosis (advice only)
get_coaching()          → integrated cross-domain driving advice (handling ⇄ tyres ⇄ energy)
verify_change(change)   → did telemetry show the driver applied a suggested change?
```
`propose_setup_change({param, delta, rationale})` exists only to **structure advice** for
the UI — it never applies anything. The driver makes every change.

Tool results are structured JSON with units + `confidence01`. The system prompt instructs
the model to quote tool numbers verbatim and to read `confidence01` before asserting.

## System prompt (sketch)

> You are the player's race engineer for an endurance sim race. Speak like a calm,
> concise real-world engineer on the radio: short sentences, no filler, numbers first.
> You have read-only tools for live car/race data and strategy — **always** get numbers
> from tools; never calculate or guess them. If a tool reports low confidence, hedge
> honestly. You cannot change anything in the game: when a change is needed, tell the
> driver the exact, specific change to make (e.g. "brake bias back two clicks") and, once
> telemetry shows they made it, confirm. Default to brevity; expand only when asked.
> Units: report fuel in liters, temps in °C, gaps in seconds.

Persona is configurable (calm veteran / energetic / terse) and affects phrasing only, not
behavior. Persona + system prompt + tool schema are cached.

## Example exchanges

- Driver: *"How's my fuel?"* → `get_fuel_plan()` → "Fuel's good — fourteen laps in the
  tank, you need twelve to the stop. No saving needed."
- Driver: *"Should I undercut the 51?"* → `get_rivals()`, `evaluate_undercut(51)` →
  "Undercut works. Box now, you come out about a second ahead after he stops. Push the
  out-lap."
- Driver: *"The car won't rotate into the corner."* → `get_current_aids()`,
  `get_handling_diagnosis()` → "You're on brake bias 58 — move it back two clicks and it'll
  rotate better on entry." → (driver changes it) → `verify_change(...)` → "Good, that's it."
- Driver: *"What do you suggest for strategy?"* → `get_fuel_plan()`, `get_stint_plan()`,
  `get_rivals()` → "Two stops. Fuel save half a litre a lap to lap 28, then short-fill —
  that undercuts the 7 and clears traffic on your out-lap."
- Proactive (integrated coaching): "Turn TC up two through Turn 4 — you're wearing the
  rears there. Save that and the tyres last to lap 34, and we undercut the 51 at the stop."
- Proactive: FCY detected, due to pit in 2 → "Full-course yellow. Box this lap — we lose
  almost nothing and you're due anyway."

## Guardrails & safety

- **The model has no tools that write to the game.** It can only read and advise; it
  cannot change aids, setup, or driving inputs. See [11-RISKS-AND-COMPLIANCE.md](11-RISKS-AND-COMPLIANCE.md).
- Refuse/avoid anything outside racing-engineer scope; keep the driver's attention on
  driving (no long monologues mid-corner — defer non-urgent talk).
- All exchanges are logged to the transcript for trust and debugging.

## Cost control

- Fast model + tools + caching for the 95% case; escalate only on demand.
- Per-session budget with a configurable cap; on cap, drop to templated proactive
  call-outs and keep radio answers terse.
- **Free by default:** the shipped profile uses a free LLM route (local Qwen / free cloud
  tier / template mode) and local STT/TTS (see [07](07-VOICE-IO.md)) — $0 for the user and
  $0 for the publisher. Cloud Claude is opt-in, bring-your-own-key.
- Estimate and surface projected cost per race hour in settings (only relevant when a
  metered cloud key is configured). Full model in [15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md).

## Evaluation

- **Replay-based eval set:** recorded race moments with a "correct" engineer response
  (or acceptable set). Score the model's call for correctness (matches tool data),
  brevity, and timing.
- **Latency tests:** measure STT→first-audio across providers; keep Tier-2 under budget.
- **Hallucination guard:** automated check that any number the model speaks appears in a
  tool result that turn.
