# 08 — Input Reading, Setup Awareness & Tuning Advice

Race Engineer is **read-only with respect to the game**. It never injects input, never
changes a setting, and never automates driving. This document covers the three things it
*does* do around controls and setup:

1. **Read** wheel/controller input — to detect the push-to-talk (PTT) button and optional
   quick-action buttons (these drive the *app*, not the game).
2. **Read** the car's current driver aids and full setup — so the engineer "already knows
   exactly how the car is set up" and can advise precisely.
3. **Advise** — tell the driver the exact change to make (aids in-race, full setup in
   practice). The driver makes every change themselves on their wheel or in the garage.

This is the project's core compliance stance — see [11-RISKS-AND-COMPLIANCE.md](11-RISKS-AND-COMPLIANCE.md).

## 1. Reading input devices (push-to-talk)

### Why we read raw devices
The PTT button is on the player's wheel. We must detect that specific button across many
device types (Fanatec, Simagic, Moza, Logitech, Thrustmaster, button boxes, etc.) without
interfering with the game's own reading of the same device.

### Mechanism
- Use **SDL2** game-controller/joystick APIs (via koffi FFI or a small prebuilt N-API
  addon) to enumerate devices and read button/axis state. SDL2 handles the widest range
  of wheels/button boxes uniformly. Raw Input / DirectInput are the lower-level Windows
  alternatives if SDL2 coverage gaps appear.
- Reading is **passive/non-exclusive**: we observe button state; the game still receives
  all input normally. We never grab exclusive access, and we never send input.

### Mapping flow (settings UI)
```
user clicks "Map push-to-talk"
   → app listens for the next button press across all devices
   → captures { deviceGuid, deviceName, buttonIndex }
   → stores binding; shows a live "pressed/released" indicator to confirm
```
Bindings supported: **PTT** (required), and optional **app-side** quick actions —
"repeat last", "acknowledge box", "next strategy view". These trigger app behavior only;
none of them send anything to the game.

### Hot-path note
Poll device state at a steady rate (100–125 Hz is plenty for button edges) on the input
thread; debounce; emit clean DOWN/UP edge events. Independent of the telemetry loop.

## 2. Knowing the car (reading aids + setup)

To give precise advice, the engineer needs the **current baseline**: what TC/ABS/brake
bias/engine map are set to, and the full mechanical/aero setup.

### Current driver aids (TC / ABS / brake bias / engine map)
- Read from the shared-memory telemetry / extended buffer if LMU exposes them; otherwise
  read from the setup file. **S3 spike** ([03](03-LMU-INTEGRATION.md)): confirm these
  values are *readable* and where. (We only read — we never write them.)
- Knowing the current value lets the engineer say "you're on TC 3 — go to 5 into the
  slow corners" and then **verify from telemetry** that the driver actually made the
  change, giving feedback if not.

### Full car setup (springs, dampers, ARBs, aero, diff, gearing, tire pressures)
- Read the player's current setup, **read-only**, from the LMU setup file (rF2 used a
  human-readable key/value text format) or from the REST API if it exposes setup state.
  **S4 spike** ([03](03-LMU-INTEGRATION.md)): locate the setup directory and confirm the
  format. We parse it into a structured `SetupParams`; **we never write setup files**, so
  there is zero risk of corrupting a user's setups.
- Parse into structured values with known safe ranges so the engineer's advice references
  real, current numbers.

## 3. Tuning advice (the engineer tells; the driver changes)

### In-race aid advice
The driver describes a problem or asks; the engineer recommends a specific, bounded change
to a permitted aid, and the driver makes it on their wheel.
```
Driver: "The car won't rotate into the corner."
   → get_setup_summary(), get_tire_status(), handling-diagnosis from telemetry
   → "Move brake bias back two clicks and drop engine braking one — that'll free the
      rear on entry."
   → (driver makes the change) → telemetry confirms brake bias moved → "Good, that's it."
```
Other examples the product should handle:
- "Turn TC up two into Turn 8 — you're spinning the rears there and it's costing tire."
- "You're locking the right-front under braking — move bias back one and brake a touch
  earlier into the chicane."

### Integrated coaching (aids/setup ⇄ tire/fuel ⇄ strategy)
The most valuable advice links a driving/aid change to a **strategic outcome**, using the
strategy engine's tire/fuel models ([05](05-STRATEGY-ENGINE.md)):
```
"Turn up your TC slip by two through Turn 4 to cut rear-tire wear. If you save about a
 tenth of wear a lap, your tires last to lap 34 and we undercut the 51 at the stop."
```
This is produced by the AI Engineer combining handling diagnosis + the deterministic
tire/fuel projections — never by guessing numbers. See [06-AI-ENGINEER.md](06-AI-ENGINEER.md).

### Practice-mode full-setup advice
In practice the whole car can be tuned. The engineer recommends; the driver applies in the
garage.
```
1. Read the player's current setup (read-only) into SetupParams.            (S4)
2. Driver states a complaint ("loose on entry, understeer mid-corner") and/or the app
   derives handling signals from telemetry.
3. The AI Engineer maps complaint + telemetry → specific recommended changes with
   rationale and expected effect (propose_setup_change — advice only, never applied).
4. The driver makes the changes themselves in the garage.
5. The app reads the new setup + fresh telemetry and shows a before/after comparison.
```
Ground recommendations in conventional setup theory (e.g. "entry oversteer → soften rear
ARB / add front wing / move brake bias forward") and let the driver iterate with
before/after telemetry compare.

### Telemetry-driven handling diagnosis (supporting feature)
Derive simple, explainable handling indicators the advice is built on:
- **Understeer/oversteer balance:** steering input + slip angles, front vs rear, through
  corners.
- **Tire temp spread:** inner-vs-outer across a tire ⇒ camber; left-vs-right ⇒ balance;
  front-vs-rear ⇒ pressure/load; out-of-window ⇒ pressure/camber/style hints.
- **Bottoming / ride height** from suspension deflection.
- **Braking stability** from brake trace + lockups (wheel speed / ABS activity).

## Interfaces (sketch) — all read-only

```ts
interface InputReader {
  listDevices(): InputDevice[];
  captureNextPress(): Promise<{ deviceGuid: string; buttonIndex: number }>;
  on(binding: BindingId, handler: (edge: 'down'|'up') => void): Unsubscribe; // app actions only
}
interface CarStateReader {
  /** Current driver-aid values if exposed (read-only). */
  currentAids(): Promise<DriverAids | null>;
}
interface SetupReader {
  /** Parse the current setup file, read-only. Never writes. */
  current(): Promise<SetupParams | null>;
  diff(a: SetupParams, b: SetupParams): SetupDiff;   // for before/after compare
}
interface AdviceVerifier {
  /** Watch telemetry to confirm the driver applied a suggested aid/setup change. */
  watchFor(change: ProposedChange): Promise<'applied'|'unchanged'|'timeout'>;
}
```

There is intentionally **no `ControlWriter`**. The app has no path to send input or write
settings to the game.

> If a future requirement ever calls for write-back, it would be a deliberate,
> separately-approved feature with its own compliance review — not a quiet addition.
> Today the answer is: the app advises, the driver acts.
