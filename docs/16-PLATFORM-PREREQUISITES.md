# 16 — Platform, Permissions & Distribution Prerequisites

The operational concerns of running on a stranger's Windows PC and publishing on GitHub.
The architecture docs (01–08) describe *what the app does*; this doc covers *what the host
machine and the release pipeline need* so it actually runs and installs cleanly. Several
items here are **spikes** to verify before the code that depends on them.

## 1. OS permissions & audio

### Microphone
- **Windows behavior:** mic access is generally granted by default but the user can revoke
  it (Settings → Privacy & security → Microphone, global + per-app). Electron's
  `systemPreferences.askForMediaAccess()` is **macOS-only** — on Windows, request via the
  standard `getUserMedia({audio:true})` flow.
- **Handle denial gracefully:** if capture fails because the OS toggle is off, show a clear
  message and deep-link to the settings page via `shell.openExternal("ms-settings:privacy-microphone")`.
  Never crash or silently fail; the radio is the core feature.
- **First-run mic test** (see onboarding §5): confirm a device, capture a short clip, show a
  level meter, confirm transcription works.
- **No-mic fallback:** allow a text-input radio box so the app is usable without a mic.

### Audio output
- **Device selection:** let the user route the engineer voice to a specific output device
  (e.g. headset) separate from game audio. Enumerate devices; follow the OS default; handle
  hot-plug and default-device changes without crashing.
- **Echo/bleed:** if the voice plays through speakers it can leak into the mic. Mitigations:
  PTT already gates capture; recommend a headset; optionally duck/suppress mic capture while
  TTS is playing (we control both ends).
- **Format:** standardize capture sample rate for STT; resample as needed per provider.

## 2. Local-model lifecycle & external dependencies

The free profile depends on local models — plan how a user obtains and runs them.

### Acquisition
- **First-run download, not bundled, by default.** Bundling multi-GB models bloats the
  installer; download on first use with visible progress, into the app's user-data dir, with
  checksum verification and version pinning. Offer an **offline bundle** option for users
  with no internet at the rig.
- **Footprint:** document disk/VRAM/RAM per model (STT, TTS, optional local LLM).

### Runtimes / dependencies
- **Local LLM (Route B):** requires **Ollama** (or a bundled `llama.cpp`/`llama-server`).
  Detect if Ollama is installed/running; guide install or bundle a runtime. Decide bundle vs.
  detect during the build (see spike).
- **GPU STT:** `faster-whisper` on GPU needs **CUDA + cuDNN**; ship a **CPU fallback** so it
  works with no GPU stack. Detect CUDA availability at runtime and pick automatically.
- **VRAM detection:** read available VRAM and recommend a route (local LLM only when there's
  headroom beyond the sim — see [15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md)
  §GPU contention).
- **TTS:** the engineer voice is streamed live from the local TTS (nothing pre-rendered). Two local
  backends are wired (`apps/desktop/src/voice/`):
  - **Piper** — a spawned binary + a `.onnx` voice model (paths configured in Settings); lightest.
  - **Kokoro** — higher quality, runs **in-process via the optional `kokoro-js`** package (ONNX
    Runtime), which **self-downloads** the ~80 MB Kokoro-82M model on first use and caches it (no
    paths to configure). It's an opt-in dependency so it never bloats the base installer: enable with
    `pnpm --filter @race-engineer/desktop add kokoro-js`. Without it, selecting Kokoro surfaces a
    clear "install kokoro-js" error; the default profile uses Piper. **S7:** decide bundle-vs-download
    for the Kokoro model and whether to ship `kokoro-js`/`onnxruntime-node` in the installer.

## 3. Game integration prerequisites

- **rF2 Shared Memory Map plugin** must be installed in LMU (see [03-LMU-INTEGRATION.md](03-LMU-INTEGRATION.md)).
  **Spike S5:** confirm the plugin's license and whether we may **bundle + auto-install** it
  into LMU's plugins folder, or must **guide manual install**. Until confirmed, ship a guided
  installer (detect LMU path, copy with consent, verify) rather than silent bundling.
- **LMU install-path detection** (Steam/Epic library scan, registry, or user-pointed).
- **Plugin health:** detect missing/disabled/wrong-version plugin and surface a fix path.
- **Coexistence:** multiple processes can read the same memory-mapped files, so running
  alongside SimHub/CrewChief should be fine — confirm during S1.

## 4. Distribution, signing & trust

- **Code signing (publisher cost — keep it free):** unsigned installers trigger Windows
  SmartScreen ("Windows protected your PC") and erode trust. Options:
  - **SignPath Foundation — recommended.** Free code signing for qualifying open-source
    projects (Sectigo OV cert, verified against the repo). Keeps the project at **$0**.
  - **Azure Artifact Signing** (~$10/mo) — note individual developers are limited to US/Canada
    (this project's maintainer is EU; an org may qualify), and it still has a SmartScreen
    reputation ramp.
  - **OV/EV certificate** (~$220–290/yr) — last resort.
  - **Ship unsigned** — acceptable for early dev/personal use; document the SmartScreen
    warning. Don't ship unsigned to non-technical users long-term.
- **Antivirus false positives:** an app that reads game memory, captures the mic, and ships
  native binaries can trip AV heuristics. Mitigate by signing, building reputation, and
  submitting false-positive reports to AV vendors. Document the expected first-run warnings.
- **Auto-update:** electron-builder `autoUpdater` against **GitHub Releases** (free feed).
  Pick a channel (stable/beta).
- **Targets:** Windows 10/11 x64 (decide on ARM later). Installer = NSIS.

### Building the installer (electron-builder) — wired

`apps/desktop` packages with **electron-builder** (config: `apps/desktop/electron-builder.yml`). The
electron-vite `build` already bundles every workspace package's TS into `out/`; electron-builder wraps
`out/` + the traced production deps into an installer. **Build on Windows** (the hard platform target):

```
pnpm install                 # once — fetches the electron + native (koffi/better-sqlite3) binaries
pnpm --filter @race-engineer/desktop dist:win   # electron-vite build → electron-builder --win
```

Emits to `apps/desktop/dist/`: a **NSIS installer** (`Race Engineer-<ver>-setup.exe`, choose-dir,
per-user) and a **portable** exe. Notes:

- **pnpm hoisting.** electron-builder traces production deps from `node_modules`; pnpm's symlinked
  layout can hide transitive natives. If a packaged build can't find `koffi`/`better-sqlite3`, add
  `node-linker=hoisted` to `.npmrc` (or `public-hoist-pattern[]=*koffi*` / `*better-sqlite3*`) and
  reinstall. The native addons are kept **outside the asar** (`asarUnpack`) so their `.node`/`.dll`
  load at runtime.
- **SDL2.dll (wheel PTT).** Drop it in `apps/desktop/build-resources/win-extra/`; electron-builder
  copies it **next to the installed `.exe`**, where the input backend resolves `SDL2.dll` by default. (S6.)
- **Icon + branding.** `apps/desktop/build-resources/icon.ico` is committed (a steering-wheel mark,
  generated by `build-resources/make-icon.mjs` — pure Node, no tools) and auto-picked.
  `appId`/`productName`/`copyright` are set in the config.
- **Models are not bundled** (S7) — Piper/whisper voices and the Ollama model are fetched/configured
  on first run to keep the installer small and licensing clean. First launch with nothing installed
  still works (template voice + Web-Speech fallback), then upgrades to local AI when a model appears.
- **Signing is intentionally disabled — we ship unsigned, by choice.** No certificate is configured
  and the `dist` scripts set `CSC_IDENTITY_AUTO_DISCOVERY=false`, so electron-builder never looks for
  one. Cost: a one-time SmartScreen "More info → Run anyway" (documented in the README) and a higher
  chance of an AV false positive. Wiring **SignPath** (free for OSS, S8) later removes both — no other
  config change needed. This keeps the project at **$0** with no blocker on shipping.
- **First-build `winCodeSign` symlink error (Windows).** electron-builder extracts a `winCodeSign`
  cache containing macOS `.dylib` **symlinks**; creating symlinks needs a privilege most accounts lack
  ("a required privilege is not held by the client"), so the first build can fail there. Fix: enable
  **Settings → System → For developers → Developer Mode** (grants the symlink privilege) or run the
  terminal **as Administrator** — then `dist:win` completes. (CI alternative: pre-extract the archive
  excluding `darwin/` into `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`.)

**Verified (2026-06-17):** `dist:win` produced `Race Engineer-<ver>-setup.exe` (NSIS) +
`-portable.exe` + `win-unpacked/` on the Windows box, with `koffi` correctly unpacked outside the
asar and the **steering-wheel icon embedded**. Still **unsigned** — expected until S8 (SignPath) lands.

## 5. Onboarding (consolidated first-run flow)

Supersedes the brief flow in [09-UI-UX.md](09-UI-UX.md) §F. Sequence:
1. Check Windows version / prerequisites.
2. Detect LMU; install/verify the shared-memory plugin (guided).
3. **Choose profile:** Free (local) or Premium (bring-your-own-key).
4. If free: detect GPU/VRAM, download/verify local models (STT, TTS, optional local LLM),
   note Ollama if the local-LLM route is chosen. If premium: enter keys (stored in OS secure
   storage).
5. Microphone permission + device pick + level test + transcription test.
6. Audio output device pick + a spoken sample.
7. Map the push-to-talk wheel button.
8. Dry-run radio exchange against synthetic or live data.

## 6. Observability, diagnostics & privacy

- **Local logging:** rotating logs, configurable level, **secret-scrubbed** (never log keys,
  never log raw audio by default). 
- **Diagnostics export:** one-click bundle (logs + config with secrets redacted + plugin/
  provider health) the user can attach to a GitHub issue.
- **Crash handling:** local crash dumps the user chooses to share — **no automatic crash
  upload**.
- **No telemetry/analytics by default.** If usage analytics are ever added, opt-in only.
- **EU/GDPR posture:** local-first keeps personal data on-device; cloud (BYO-key) modes send
  only PTT-window audio/text to the user's chosen provider. State this in a short privacy note.

## 7. Legal & branding

- **License:** choose an OSS license (MIT or Apache-2.0 recommended; Apache-2.0 adds a patent
  grant). Set it before the first public commit.
- **THIRD-PARTY / NOTICE file:** track licenses of bundled/used components — CTranslate2/
  faster-whisper, Piper, Kokoro, Qwen, the rF2 plugin, provider SDKs. **XTTS v2 is
  non-commercial — excluded.** Verify each model's license permits redistribution before
  bundling vs. download-on-first-run.
- **Affiliation disclaimer:** "Race Engineer is an independent project and is not affiliated
  with, endorsed by, or sponsored by Le Mans Ultimate, Studio 397, or Motorsport Games."
- **Privacy note:** short, plain-language data-handling statement (what's local, what leaves
  in BYO-cloud mode, no analytics).

## 8. System requirements (to publish in the README)

| Profile | CPU | RAM | GPU / VRAM | Disk | Notes |
| --- | --- | --- | --- | --- | --- |
| **Minimal free** (local voice + free cloud-tier brain) | modern quad-core | 8 GB free | none required (CPU STT/TTS) | ~2–3 GB models | Internet for the free LLM tier |
| **Full local** (local LLM too) | 8-core+ | 16 GB+ free | **24 GB+** *or a second machine* (sim already uses the primary GPU) | ~10 GB+ | Ollama; offline-capable |
| **Premium cloud** (BYO-key) | modern quad-core | 8 GB free | none | ~2 GB | Internet; user's API keys |

The app runs **alongside** a demanding sim — budget for that. See [15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md) §GPU contention.

## 9. Misc runtime concerns

- **Single-instance lock** — refuse to launch a second copy.
- **Non-race states** — garage/menu/replay/spectate must be handled gracefully (no spurious
  call-outs; UI shows "waiting / not in a session").
- **Config-schema versioning** — version stored settings and migrate on upgrade.
- **Firewall** — localhost REST reads usually need no firewall grant; outbound cloud calls
  are normal. Note if Windows prompts.

## Spikes added by this doc (continuing S1–S4 in [03-LMU-INTEGRATION.md](03-LMU-INTEGRATION.md))

- [ ] **S5** — rF2 SMMP plugin license + whether bundle/auto-install is permitted (else guided install).
- [ ] **S6** — Reading the wheel via SDL2 while LMU has the device (shared vs exclusive); device-GUID stability across reconnects.
- [ ] **S7** — Bundle-vs-download decision + sizes for each local model; Ollama detect-vs-bundle.
- [ ] **S8** — Confirm SignPath Foundation eligibility for this project; set up signing in CI.
