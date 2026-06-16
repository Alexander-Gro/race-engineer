# Handoff — moving development to the Windows PC (with LMU)

_Snapshot: 2026-06-16. Two lines of work were done in parallel and must be reconciled first._

- **`main`** (origin) — 6 **rig commits** done on the Windows PC: S1–S5 spikes (T1.1–T1.5) +
  traffic/`lapDistanceM` fixes. The real LMU integration findings live here.
- **`mac-offline-build`** (branch, PR open) — 20 **offline commits** from the Mac session: the
  Virtual Energy feature + M8/M9 offline depth + voice backends + tooling. All green (771 tests),
  every commit compliance-reviewed.

Both branched from `50f6083`. **Do §0 before anything else.**

---

## 0. Reconcile `mac-offline-build` → `main` (FIRST, on Windows)

The two lines overlap. Pull both, merge the branch into `main` (or rebase the branch), and resolve:

- **`.svm` parser collision (the big one):** both lines independently created
  `packages/adapters/lmu/src/setup/svm.ts` (+ `__tests__/svm.test.ts`).
  → **Keep the rig version (T1.4)** — it's verified against the real `fixtures/sample-gt3.svm`.
  → **Port any extras from the Mac version (T9.1)** that the rig one lacks — likely
  `setupSummaryFromSvm` (canonical `SetupSummary`) and `diffSetups` (before/after, used by T9.5
  `compareHandling`). Then delete the duplicate.
- **`packages/adapters/lmu/src/index.ts`:** merge both export lists; keep one `setup/svm` export; add
  the Mac exports (`rest/probe`, `rest/virtual-energy`, `rest/aids`, `capture`).
- **`packages/core/src/schema/race-state.ts`:** rig allowed negative `lapDistanceM`; Mac added
  `player.virtualEnergy`. Different regions — **keep both**.
- **`packages/core/src/__tests__/schema.test.ts`:** both added cases — keep both.
- Check `traffic.ts`/`traffic.test.ts` (rig changed class-pace ranking) vs nothing on the Mac side —
  rig wins; no overlap expected.
- After resolving: `corepack pnpm i && pnpm typecheck && pnpm lint && pnpm test` must be green, then
  merge to `main`. Delete `mac-offline-build`.

**Then use the S2/S3 findings to correct the Mac tolerant mappers (they were built on guessed field
names — now confirm them against the real probe):**
- `rest/virtual-energy.ts` `virtualEnergyFromRest` — replace the candidate `LEVEL_KEYS`/`PER_LAP_KEYS`
  with the real `/rest/strategy/usage` field names from the T1.2 S2 probe.
- `rest/aids.ts` `aidsFromRest` — wire to wherever the T1.3 S3 finding says the TC/ABS/engine-map
  indices actually live (REST garage vs setup file).
- `tools/capture.ts` (`pnpm capture`) already dumps these in one pass if you need to re-check.

---

## 1. What's done & on a branch (Mac, offline — all tested)

- **M11 Virtual Energy** (the flagged gap) — full chain: canonical schema, binding-constraint math
  (`min(fuel, VE)`), live `StrategyEngine` + dashboard badge, AI tools + template/voice answers,
  REST→canonical mapper, proactive `energy_low` call-out.
- **M8** — aids reader (T8.1), background strategist → `strategy_update` (T8.2), integrated coaching
  (T8.3); advice-verify (T8.4) + proactivity (T8.5) were already done.
- **M9** — `.svm` parser (T9.1, reconcile w/ rig), setup screen (T9.3), setup advice (T9.4),
  before/after compare (T9.5).
- **M10 slices** — diagnostics export (T10.3), readiness model (T10.2), cost estimator; handling card
  (T9.2 follow-up); `tire_temp_out_of_window` rule (T3.2 gap).
- **T10.1 local voice** — Piper TTS + whisper.cpp STT native backends (injected spawner, mock-tested)
  + worker wiring (`attachLocalBackends`); not yet live (needs real binaries/models — see §2).
- **`pnpm capture`** — one-shot rig REST/`.svm` dump.

## 2. What's left — needs Windows / hardware / decisions

**A. Make the live data path real (uses the rig findings):**
1. Wire the confirmed REST field names into the VE/aids mappers (§0).
2. Wire the ~2 Hz REST poll into `apps/desktop/src/lmu-host.ts` **off the 50 Hz SHM hot path**, merging
   via `withVirtualEnergyFromRest` / `withAidsFromRest`.
3. Settle the setup-file location/nesting + the key→aid mapping (T1.3/T1.4) and read it live.

**B. Local voice (make the free, no-key profile actually talk/listen):**
1. Install **Piper** + a voice `.onnx`, and **whisper.cpp** + a `ggml` model (Windows).
2. Fill the model specs in the **model manager** (real download URLs + SHA-256) — can't be guessed.
3. Feed the resolved binary/model paths into the voice route (`ttsConfig`/`sttConfig`) and **widen the
   worker voice build-gate** (`voiceRouteIsCloud(route) || ENGINEER_VOICE=1`) to also admit a ready
   *local* route.
4. Smoke-test: select Piper/whisper → confirm audible reply + transcribed PTT.
5. Follow-ups: **Kokoro ONNX** + **faster-whisper** backends (the default-profile engines; the working
   pair today is piper + whisper-cpp).

**C. Input:** map a real **wheel button for PTT** (SDL2.dll on the rig) — the `PttMapper` flow exists;
the on-screen 🎙 button needs no SDL2.

**D. Packaging / distribution (T10.5) — mostly not started:**
- electron-builder installer + auto-update (GitHub Releases).
- **Code-signing — needs a decision:** enroll the project in **SignPath Foundation** (free for OSS) +
  CI secrets, or choose another signing identity.
- `THIRD-PARTY` / `NOTICE` files.

**E. Polish:**
- Onboarding flow UI (T10.2 — the readiness *model* is built; the guided flow isn't).
- Crash isolation / graceful-degradation wiring (T10.3 — diagnostics export is built).
- Tailwind/shadcn **UI reskin** (deferred; all dashboard view-models are built + tested — this is
  presentation, design-led).

**Decisions needed from you:** ① code-signing path; ② local models bundled vs download-on-first-run;
③ UI look/feel direction for the reskin.

## 3. Status (effort-weighted estimate)

- **Logic / code: ~93%** (heavily tested). **Rig integration: ~60%** after the Windows spikes (was 40%;
  the offline mappers + the rig findings just need wiring together). **Native/runtime: ~50%.**
  **Packaging/distribution: ~15%.** **UX polish: ~10%.**
- **Overall to a shippable, signed, rig-validated v1: ~72%.** The remaining work is "last-mile"
  (integration + packaging + signing + polish), which is a real chunk of calendar time even though the
  engineering logic is largely done.

## 4. Commands (Windows)

```
corepack pnpm i
pnpm typecheck && pnpm lint && pnpm test     # gate
pnpm dev            # synthetic dashboard
pnpm dev:lmu        # live LMU source
pnpm capture --svm <path-to-a.svm>           # one-shot rig REST/.svm dump
pnpm record         # record a real stint → replay fixture
pnpm eval replay <file>                       # accuracy/latency eval on a recording
pnpm shm-dump       # raw shared-memory dump
```
