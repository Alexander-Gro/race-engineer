# 09 — UI / UX

Voice is the primary interface; the screen is backup and configuration. The UI must be
**glanceable** (readable in a 0.5 s look while driving), **calm** (no clutter or
animation noise), and **honest** (show confidence, show when data is stale).

## Surfaces

1. **Main window** (alt-tab / second monitor): full dashboards, strategy, setup, history,
   settings.
2. **In-game overlay** (optional): a small always-on-top, transparent, click-through
   window over the game for the few things you want while driving.
3. **Voice** (primary): the engineer speaking + the PTT radio.

> Overlay caveat: transparent always-on-top windows reliably draw over **borderless /
> windowed** games, not exclusive-fullscreen DirectX. Recommend borderless mode (most sim
> racers already use it for multi-app setups). Document this clearly in onboarding.

## Screens

### A) Live Dashboard (default)
Glanceable race state, large type, color-coded:
- **Fuel:** liters remaining, per-lap, **laps remaining** (big), to-finish delta, save
  target if active. Confidence indicator.
- **Tires:** 4-corner widget — temps (inner/center/outer color bands vs target window),
  pressures, wear%. Compound label.
- **Brakes:** 4-corner disc temps vs window.
- **Aids:** TC / ABS / brake bias / engine map current values (and the engineer's last
  recommendation, if any — the driver applies changes, the app reads them back).
- **Position & gaps:** overall + class position; gap + name + **class** for car ahead and
  behind; closing-rate arrows; faster-class-approaching warning strip.
- **Timing:** last lap, best lap, delta to best, sector colors.
- **Session:** time/laps remaining, current flag, next pit window.

### B) Strategy
- Stint plan timeline (current + planned stints, pit windows, mandatory stops).
- Fuel projection chart (fuel vs laps, to-finish line, save scenarios).
- Tire degradation / pace trend.
- Rival tracker: key rivals, their pit status, undercut/overcut indicator.
- Each recommendation states its rationale and confidence; "Ask engineer" expands it.

### C) Setup (practice)
- Editable setup grouped by subsystem (tires, springs, dampers, ARBs, aero, diff,
  gearing, brakes) with safe ranges and current vs proposed values.
- AI suggestions panel: type/speak a complaint → recommended changes with rationale and
  expected effect. The driver applies the change themselves in the garage; the app then
  reads the new setup and shows a before/after telemetry compare. (The app never edits the
  setup.)
- Handling-diagnosis readout (understeer/oversteer balance, tire-temp spread, bottoming).

### D) History / Sessions
- Past sessions, laps, stints; learned fuel/tire models per car/track/conditions;
  transcript playback (what the engineer said and when).

### E) Settings
- **Voice:** persona/voice pick, cloud vs local mode, output device, SFX, quiet-window
  sensitivity, projected cost-per-hour.
- **Controls:** PTT mapping + app-side quick-action bindings (press-to-map UI). No
  game-write settings exist — the app is read-only/advisory.
- **AI:** model tiering, verbosity, proactivity level (chatty ↔ minimal), budget cap.
- **Game:** plugin status/health, install helper, REST connection status.
- **Keys:** Claude/STT/TTS API keys (stored via OS secure storage; never logged).

### F) Onboarding (first run)
Guided: verify Windows prerequisites → install/verify telemetry plugin (detect LMU) →
**choose profile (Free local vs Premium BYO-key)** → download/verify local models + GPU
detect (free) or enter keys (premium) → microphone permission + device + level test →
audio-output pick + spoken sample → map PTT button → dry-run radio exchange. Full flow and
the OS-permission/model-download specifics are in [16-PLATFORM-PREREQUISITES.md](16-PLATFORM-PREREQUISITES.md) §5.

## Overlay (in-race minimal)
Configurable widgets, draggable, opacity + click-through:
- Fuel laps-remaining, tire/brake temps, aids, gaps to ahead/behind (+class), flag,
  next pit window, and a small "engineer speaking / listening" indicator.
Keep it tiny and peripheral. Default off; opt-in during onboarding.

## Visual + interaction design
- **Stack:** Tailwind + shadcn/ui; dark, high-contrast, motorsport-instrument feel.
- **Color language:** green = good/in-window, amber = caution/approaching limit, red =
  act-now (fuel critical, tire out of window, urgent flag). Color is reinforced with
  shape/text (accessibility; some drivers are colorblind).
- **Typography:** large numerals for the values you read mid-drive (fuel laps, gaps).
- **Motion:** minimal; value changes ease, nothing flashes gratuitously. Animation must
  never compete with driving.
- **State honesty:** stale/disconnected data is visibly marked; estimates show
  confidence; "engineer is talking / listening" is always indicated.

## Accessibility
- Colorblind-safe palettes + non-color encodings.
- Scalable text; overlay size presets.
- Full keyboard/controller navigation of the main window.
- Voice-first design already aids drivers who can't look at a screen mid-corner.

## Performance discipline (it runs next to a demanding sim)
- Throttle dashboard redraws to ~10–15 Hz (telemetry updates faster than eyes need).
- Keep heavy charts off the overlay; pause/limit rendering when the main window is hidden.
- Hot loop stays in the worker; the renderer only consumes throttled snapshots over IPC.
