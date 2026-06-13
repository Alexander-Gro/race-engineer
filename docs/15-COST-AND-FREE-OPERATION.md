# 15 — Cost & Free Operation

Race Engineer is **free and open-source**, and it is designed so that:

1. **The publisher (you) never pays for inference** — there is no server you run and no
   shared key, so cost does not scale with the number of users. Even at 100,000 users your
   inference bill is **$0**.
2. **A user can run the whole app for free** — the default profile uses local models that
   need no account, no key, and no internet.
3. **Cloud providers are opt-in, bring-your-own-key** — a user who wants cloud quality
   plugs in *their own* key (or free tier). Their account, their bill, entered and stored
   locally.

This document is the canonical reference for cost and for the free/local operating model.

## The economics of an open-source desktop app

Race Engineer is a **client-side desktop application**. It runs entirely on each user's
machine. There is no central backend, and no shared credential. Therefore:

- **Inference cost is borne per-machine by whoever runs it**, never centrally. Local
  models cost the user nothing but their own electricity; a cloud key bills that user's
  own account.
- **The publisher's marginal cost per user is zero.** Publishing on GitHub creates no
  ongoing liability.

### The only three ways an OSS author gets a surprise bill — and how we avoid all three

| Trap | What happens | How we avoid it |
| --- | --- | --- |
| **Committing an API key to the repo** | Public keys are scraped by bots within minutes and drained | **No key is ever embedded.** Secrets live only in the user's OS secure storage (Electron `safeStorage` / Windows DPAPI), never in the repo, never in logs, never in build artifacts. CI secret-scanning blocks accidental commits. |
| **Running a central proxy/backend** with the author's key | The author eats every user's usage cost | **There is no server.** The app calls providers directly from the user's machine using the user's own configuration. |
| **A leftover demo/hosted deployment** | Quietly accrues cost | **Nothing is deployed.** Distribution is a desktop installer; there is no hosted component. |

> **Architectural rule (see [CLAUDE.md](../CLAUDE.md)):** local-first, bring-your-own-key,
> **no embedded secrets, no central server.** Any future hosted component would be a
> deliberate, separately-decided change — not a quiet addition.

## Two operating profiles

The app ships with provider interfaces (LLM / STT / TTS) behind swappable adapters, and a
**profile** selects which providers are active.

### Free profile (default, ships enabled)
Works out of the box with **no signup, no key, fully offline-capable**:

| Job | Default free provider | Runs on |
| --- | --- | --- |
| Strategy / events / spotter math | Deterministic TypeScript | CPU, always free |
| STT | **faster-whisper** (turbo/small model) | GPU (3–4 GB) or CPU |
| TTS (conversational) | **Kokoro** (quality) or **Piper** (lightest) | CPU or 1–2 GB VRAM |
| TTS (spotter call-outs) | Pre-rendered once from the local TTS | $0 at runtime |
| LLM brain | **Local Qwen 3.x** (tool-calling), a **free cloud tier**, or **template mode** | see §LLM routes |

Voice is fully local and private in this profile; nothing leaves the machine unless the
user opts into a cloud LLM.

### Premium profile (opt-in, bring-your-own-key)
A user who wants the best experience supplies their own key for any slot:

| Job | Optional cloud provider (user's key) |
| --- | --- |
| LLM | Anthropic Claude, or any provider the user configures |
| STT | Deepgram / OpenAI |
| TTS | ElevenLabs / Azure Neural / OpenAI |

The app never holds a billable credential — the user enters their own, stored locally.

## The LLM brain — free routes

The LLM only phrases results and adds light judgment; the deterministic engine does all the
math (see [05-STRATEGY-ENGINE](05-STRATEGY-ENGINE.md), [06-AI-ENGINEER](06-AI-ENGINEER.md)).
That means a free or modest model is more than adequate. Three free routes:

- **Route A — Free cloud tier (no local GPU load).** The user's own free-tier account on
  Groq (Llama 3.3 70B, very low latency), Google Gemini (Gemini Flash), or OpenRouter
  (rotating free models). Zero local compute, so no contention with the sim. Generous
  limits (see rate-limit math below). Caveat: free tiers may log/train on prompts and can
  change over time.
- **Route B — Local LLM (offline / max privacy).** Qwen 3.x is the best local tool-caller;
  our tool surface is simple read-only getters, well within its ability. **Constraint:**
  see §GPU contention.
- **Route C — Template mode (no LLM).** ~70–80% of common radio queries are structured
  ("how's my fuel?", "who's behind me?") and can be answered by templates filled from the
  strategy engine — fully offline, instant, zero dependency. Ships as the universal
  fallback under every profile.

## GPU contention — the sim-rig reality

The single biggest practical constraint: **the sim already uses the GPU.** A modern sim
wants 8–12 GB of VRAM; a quantized 8B LLM wants another 5–6 GB. On one GPU they fight for
VRAM, and overflow into system RAM slows the LLM ~30× and stutters the game.

Implications for the free profile:

- **STT + TTS are light** (small VRAM or CPU) and run fine alongside the sim. Local voice
  is always viable.
- **A local LLM is only comfortable** with a 24 GB+ GPU, on a **second machine** on the LAN
  (even a cheap mini-PC), or accepting slow CPU inference. On a typical single-GPU rig
  mid-race, prefer **Route A (free cloud tier)** or **Route C (template mode)**.

The app detects available VRAM and recommends a route; it never silently starves the game.

## Rate-limit math (free cloud tiers cover endurance)

At roughly **30 LLM interactions per hour** (radio + proactive), a full 24-hour Le Mans is
~720 calls — comfortably inside free daily quotas:

| Free tier (≈ June 2026, subject to change) | Daily limit | Hours of racing/day |
| --- | --- | --- |
| Google Gemini (Gemini Flash) | ~1,500 req/day | ~50 h |
| Groq (per model) | ~1,000 req/day | ~30 h |
| OpenRouter (free models) | 50–1,000 req/day | ~1.5–30 h |

A provider fallback chain (e.g. Groq → OpenRouter → Gemini → template mode) ensures a
rate-limit never silences the engineer.

## What a user *might* optionally pay (premium profile)

If a user opts into cloud providers with their own key, indicative cost per racing hour:

| Profile | LLM | STT | TTS | Per hour | 24 h Le Mans |
| --- | --- | --- | --- | --- | --- |
| **Free (default)** | local / free tier | faster-whisper | Piper/Kokoro | **$0** | **$0** |
| **Budget cloud** | Haiku-tiered (~$0.15) | Deepgram (~$0.02) | OpenAI/Azure (~$0.10) | ~$0.25–0.40 | ~$6–10 |
| **Premium cloud** | Opus (~$0.50) | Deepgram | ElevenLabs (~$1–3) | ~$1.50–4 | ~$40–90 |

(Claude pricing for reference: Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15, Opus 4.8 $5/$25 per 1M
input/output tokens; prompt caching keeps the LLM cost low.) These are **the user's**
optional costs — never the publisher's.

## Honest caveats

- **Privacy:** free cloud tiers may log/train on prompts; the free profile's voice stays
  local, and only radio *text* would leave if a cloud LLM is enabled. Local/template = fully
  private.
- **Free-tier longevity:** quotas change (Google tightened them in late 2025). Local and
  template modes never change out from under you, which is why the default profile does not
  *depend* on any cloud free tier.
- **Quality:** free/local models are less capable than premium cloud at subtle judgment —
  acceptable here because the math is deterministic and the tool surface is simple.

## Defaults summary

- Ship the **free profile** enabled, so a fresh clone runs at $0 with no key.
- Make every cloud provider **opt-in, bring-your-own-key**, stored only in OS secure storage.
- Keep **template mode** as the always-available fallback so the app is useful even fully
  offline and even if every cloud free tier disappears.
- **Never** embed a key, ship a shared credential, or run a central paid backend.
