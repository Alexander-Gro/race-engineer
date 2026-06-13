# 02 — Technology Stack

This document records the **chosen stack**, the **reasoning**, and the **alternatives**
considered, so the decision can be revisited deliberately rather than by drift.

## Constraints that drive the choice

1. **Windows-only target.** LMU and its telemetry interfaces are Windows. No need for a
   cross-platform abstraction; do lean on Windows-native facilities.
2. **Native access required.** Reading memory-mapped files and wheel/controller input
   are native operations. Whatever we pick must reach Win32 / SDL2 cleanly.
3. **Real-time, but not extreme.** The hot loop handles a few hundred floats per tick at
   tens of Hz. This is comfortably within reach of a managed runtime; the dominant
   latency is in AI/voice network round-trips, not in reading memory.
4. **AI-heavy and fast-iterating.** The conversational engineer is the product's soul
   and will be tuned constantly. First-class AI SDKs and rapid iteration matter a lot.
5. **Shippable to non-technical sim racers.** Installer-friendly distribution.

## Decision: TypeScript-everywhere on Electron, with FFI for native bits

| Layer | Choice |
| --- | --- |
| Shell | **Electron** (latest LTS) |
| UI | **React + TypeScript + Vite**, **Tailwind CSS**, **shadcn/ui**, **Zustand** for state, **Recharts/visx** for telemetry charts |
| Main process | **Node.js + TypeScript** (strict) |
| Hot path | TypeScript in a **worker thread / utility process** |
| Native (memory + input) | **koffi** FFI to Win32 (`OpenFileMapping`, `MapViewOfFile`) and **SDL2** for input; a small prebuilt N-API addon as a fallback if FFI struct decoding gets unwieldy |
| AI | Provider interface (swappable). **Free default:** local **Qwen 3.x** (Ollama) / free cloud tier (Groq, Gemini, OpenRouter) / template mode. **Optional BYO-key:** **`@anthropic-ai/sdk`** (Claude) with tool use; streaming |
| STT | **Free default:** local **faster-whisper** (whisper.cpp for CPU/portable). **Optional BYO-key:** Deepgram / OpenAI streaming |
| TTS | **Free default:** local **Piper** (lightest) / **Kokoro** (quality). **Optional BYO-key:** ElevenLabs / Azure Neural / OpenAI |
| Storage | **SQLite** via **better-sqlite3** (synchronous, fast, simple) |
| Secrets | OS secure storage via Electron **safeStorage** (DPAPI on Windows) |
| Packaging | **electron-builder** (NSIS installer + auto-update) |
| Testing | **Vitest** (unit), **Playwright** (UI), recorded-session replay harness |
| Lint/format | **ESLint + Prettier**, **TypeScript** strict |

### Why this stack

- **Single language end-to-end.** One mental model, one toolchain, no Node↔Python (or
  Node↔C#) marshalling. Claude Code is at its most productive here, which matters
  because this codebase will iterate heavily on AI behavior.
- **Best-in-class AI ergonomics.** The Anthropic TypeScript SDK, streaming, and tool use
  are first-class; wiring STT/TTS providers over HTTP/WebSocket is straightforward.
- **Native access without a second runtime.** `koffi` is a prebuilt FFI library (no
  per-machine compilation) that can call `OpenFileMapping`/`MapViewOfFile` to read the
  rF2 shared-memory map, and SDL2 for robust cross-device wheel input. The native
  surface area is small and well-contained in `packages/adapters` and `packages/input`.
- **Rich, real-time UI for free.** Web tech is ideal for the dense, animated dashboards
  (tire temps, fuel bars, gap timelines) this app needs, and for an always-on-top
  transparent overlay.
- **Acceptable distribution.** electron-builder produces a signed installer with
  auto-update. No Python-bundling pain.

### The main tradeoff we are accepting

**Memory/CPU footprint.** Electron is heavier than a native app, and it runs alongside a
demanding sim. Mitigations: run the renderer lean, keep the hot loop in a worker, cap
chart redraw rates, and offer a "minimal overlay only" mode. If footprint proves
unacceptable in testing, the escape hatch is **Tauri** (see alternatives) — the pure
`core`/`strategy` packages are runtime-agnostic and would port cleanly.

## Alternatives considered

| Option | Strengths | Why not primary |
| --- | --- | --- |
| **.NET 8 / C# (WinUI/WPF/Avalonia)** | Best native Windows access; trivial `MemoryMappedFile`; **CrewChief** (the closest existing open-source AI race engineer) is C#/.NET — a proven reference path; cleanest single-exe distribution | Slower AI-iteration ergonomics; weaker fit for the dense web-style UI and overlay; team/Claude-Code velocity is higher in TS. **This is the strongest fallback** — pick it if native simplicity and distribution outweigh AI iteration speed. |
| **Tauri 2 (Rust core + React/TS UI)** | Tiny footprint (ideal next to a sim), no-GC native hot loop, good distribution | Native work (memory, input, FFI) must live in Rust, reintroducing a second language; steeper curve. Best if Electron footprint becomes a real problem. |
| **Python core + JS/Tauri shell** | Fastest AI/ML prototyping; `pyRfactor2SharedMemory` exists as reference; great Anthropic SDK | Two runtimes; bundling Python for end users is the jankiest distribution story; only worth it if we need Python-only ML libraries. |
| **Pure web app (browser)** | Zero install | Cannot read shared memory or wheel input; non-starter for the core feature. |

## Reference projects to study (do not copy licenses blindly)

- **CrewChief V4** (C#) — open-source voice race engineer/spotter supporting rFactor 2
  and LMU. The canonical proof that the shared-memory + voice approach works for LMU;
  excellent reference for event taxonomy and call-out phrasing.
- **rF2 Shared Memory Map Plugin** (The Iron Wolf, C++) — the sanctioned telemetry
  interface and the struct definitions we must mirror.
- **pyRfactor2SharedMemory** — Python reference for decoding those structs.
- **SimHub / Second Monitor** — references for the LMU REST API usage and dashboards.

## External services & cost posture

- **Free by default, for both publisher and user.** The shipped profile runs on local /
  free-tier models with no key and no central server, so publishing on GitHub creates no
  ongoing cost. The full cost model, free-operation profiles, and no-surprise-bill design
  are in [15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md).
- **LLM:** free local Qwen / free cloud tier / template mode by default; optional Claude
  (fast model for radio, larger for deliberative) via the user's own key. See [06-AI-ENGINEER.md](06-AI-ENGINEER.md).
- **STT/TTS:** local-first (faster-whisper + Piper/Kokoro) by default; cloud is opt-in,
  bring-your-own-key. See [07-VOICE-IO.md](07-VOICE-IO.md).
- All provider integrations sit behind interfaces so they are swappable and so a session
  can run fully offline at zero cost.

## Pinned decisions vs. open decisions

- **Pinned:** TypeScript everywhere; Electron shell; pure `core`/`strategy`; LLM never
  does math; tiered voice latency; adapter isolation; **read-only/advisory — the app
  never writes to the game** (no input injection or settings writes); **free,
  local-first, bring-your-own-key — no embedded secrets, no central server** (see
  [15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md)).
- **Open (decide during spikes):** exact STT/TTS providers; whether input needs a small
  N-API addon vs. pure FFI; Electron vs. Tauri if footprint testing fails; fast-model
  vs. premium-model split thresholds.
