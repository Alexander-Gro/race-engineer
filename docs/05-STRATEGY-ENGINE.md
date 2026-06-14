# 05 — Strategy Engine

The strategy engine is **pure, deterministic TypeScript**. No I/O, no LLM, no
randomness. The LLM calls these functions as tools and phrases the results; it never
reproduces the math. Every function below gets unit tests with the worked examples
given here.

> Principle: **trustworthy or silent.** Every estimate carries a `confidence01`. Below a
> confidence threshold, the engineer hedges ("roughly four laps, still learning your
> consumption") rather than asserting.
>
> Principle: **always on.** The engine recomputes every tick so the engineer is
> continuously watching for opportunities (undercut/overcut, FCY, fuel-save unlocks) and
> can key the radio proactively — not only when asked. Its outputs are recommendations
> only; the app never acts on the car.

## Inputs

- Current `RaceState` (fuel, lap times, positions, gaps, flags).
- Rolling history: recent lap times, fuel-per-lap samples, tire-wear samples.
- Learned priors from `fuel_models` / `tire_models` (per car/track/conditions).
- Session frame: timed vs lap-count, time/laps remaining, pit-lane time loss, mandatory
  stops / driver-change rules (endurance).

## 1. Fuel model

### Per-lap consumption
Maintain a robust rolling estimate from completed **green-flag** laps only (exclude
in/out laps, FCY, pit laps):

```
perLap = robustMean(recent green-flap fuel deltas)   // e.g. median of last N, N≈3–5
```

Seed from `fuel_models` prior when sample count is low; blend:
```
perLap = (priorWeight*priorMean + samples*sampleMean) / (priorWeight + samples)
confidence = samples / (samples + priorWeight)        // 0..1
```

### Laps remaining on current fuel
```
lapsRemainingOnFuel = floor(fuelLiters / perLap)      // report floor + fractional
```

### Fuel to finish (timed race)
Estimate laps left from time remaining and current green pace:
```
lapsLeft = ceil(remainingS / avgGreenLapS)            // +1 if leader will start a final lap
litersToFinish = lapsLeft * perLap
litersToAddNextStop = max(0, litersToFinish - fuelLiters + reserveLiters)
```
`reserveLiters` is a safety margin (configurable, default ~1 lap's worth).

### Fuel-save (lift-and-coast) target
If `lapsRemainingOnFuel < lapsUntilPlannedStop`, compute the per-lap saving needed to
stretch to the stop:
```
needPerLap = fuelLiters / lapsUntilPlannedStop
saveTarget = perLap - needPerLap                      // liters/lap to save
```
Translate to driver-facing coaching ("lift ~50 m earlier into the two big stops").

**Worked example.** 60 L tank, 38 L left, perLap 2.6 L → lapsRemainingOnFuel = 14.
Planned stop in 16 laps → needPerLap = 38/16 = 2.375 → saveTarget ≈ 0.225 L/lap (~9%).

## 2. Tire degradation model

Track per-stint: tire wear samples (`wear01`), tire temps vs target window, and lap-time
trend. Fit a simple degradation curve (linear or piecewise on lap-time delta vs stint
lap):

```
lapTimeDelta(stintLap) ≈ base + degRate * stintLap   // seconds lost per lap into stint
```

Use it for: predicting end-of-stint pace, comparing compounds, and deciding double-stint
feasibility. Seed from `tire_models` priors per car/track/compound. Keep it simple and
honest — over-modeling tire physics is a rabbit hole; lap-time trend + wear rate covers
most strategic decisions.

## 3. Pit-stop time model

```
pitLoss = pitLaneTimeLoss + serviceTime
serviceTime = max(refuelTime(fuelToAdd), tireChangeTime if changing, repairTime)
refuelTime = fuelToAdd / refuelRateLitersPerSec   // rate is car/series specific
```
`pitLaneTimeLoss` (delta vs staying out, excluding service) is measured from telemetry
(pit entry to exit minus equivalent on-track time) and stored per track.

## 4. Stint planner

Given fuel capacity, fuel-to-finish, tire life, and mandatory stops, enumerate feasible
stint sequences and pick the one minimizing total race time subject to constraints:

- Tank capacity bounds max stint length (fuel).
- Tire life bounds max stint length (pace/wear).
- Mandatory stops / driver-change windows must be satisfied (endurance rules).
- Prefer fewer stops unless tire deg cost > pit-loss savings.

Output a `StintPlan` with stint boundaries, fuel-add per stop, compound per stint, and
pit windows. Recompute on meaningful change (pace shift, FCY, damage, weather).

## 5. Undercut / overcut

For a rival within striking range, compare pitting now vs later. You pit now for fresh tyres
while the rival stays out; over the laps they run on worn tyres you swing time in your favour:

```
undercutGainS = lapsRivalStaysOut * freshTyreGainPerLap   // you on fresh vs rival on worn, per lap
              - outLapLoss                                 // your cold-tyre / pit-exit out-lap penalty
              - (pitLossSelf - pitLossRival)               // pit-delta difference (usually ~0)
```
The fresh-tyre advantage *adds* to the swing; the out-lap penalty and any pit-delta subtract. The
per-lap swing assumes evenly-matched cars (your fresh-vs-worn gain ≈ the rival's worn-tyre deficit).

Decision (`evaluate_undercut` → `{ recommend, deltaS, undercutGainS, rationale, confidence01 }`):
pit **now** if the swing clears the gap and gains track position (chasing: passes the rival;
defending: covers their threat); pit **later** (overcut) if pitting now is a net time loss (tyres
too fresh); **hold** otherwise (within a configurable margin). `deltaS` is your projected advantage
after the cycle (signed, >0 = good for you). Present as a recommendation with the key numbers, not a
black box.

## 6. Multi-class traffic (LMU-critical)

LMU races mix Hypercar / LMP2 / GTE-GT3. The engine must forecast traffic:

- **Faster class approaching:** using `closingRateMps` and `gapToPlayerS`, warn the
  driver before a faster car arrives ("Hypercar closing, 3 seconds, leave room into the
  Esses"). Tier 1.
- **Slower class ahead:** warn of slower cars you are catching, especially into braking
  zones ("GT3 ahead in sector 2, he's 1.5 slower").
- **Pit timing vs traffic:** prefer pit windows that release you into clean air rather
  than a pack of another class.
- **Lap-time contamination:** when computing pace/fuel, down-weight laps spent stuck
  behind traffic so estimates are not poisoned.

This is a primary differentiator for LMU; budget real design time here.

## 7. Safety car / FCY opportunism

Detect FCY/SC from `FlagState`. Pit-stop time loss under FCY/SC is much smaller (field
slows/bunches), so a stop "for free" is often optimal. The core event rule edge-detects the
green→caution transition and emits a `fcy_opportunity` event (the trigger); the strategy
decision is:

```
cautionPitLossS ≈ greenPitLossS * cautionPaceFraction   // field caution pace ÷ green pace, ~0.5
savedS          = greenPitLossS - cautionPitLossS
recommend = box_now  if underCaution AND savedS ≥ minSaving AND (planned stop due soon OR mandatory due)
            stay_out otherwise   // a cheap stop you don't need just buys a later one
```

The engineer prompts: "Full-course yellow — box now, we lose almost nothing and we're due in
2 laps anyway." (`evaluateFcyStop` → `{ recommend, savedS, cautionPitLossS, reason, confidence01 }`.)

## 8. Confidence & honesty

- `confidence01` derives from sample count, variance, and how stale the prior is.
- The Event Detector won't promote a strategy event to a proactive call-out below a
  confidence floor; instead the UI shows it as tentative.
- All estimates expose their assumptions so the AI Engineer can hedge truthfully.

## Tool surface exposed to the AI Engineer

These are the only ways the LLM touches strategy (see [06-AI-ENGINEER.md](06-AI-ENGINEER.md)):

```ts
get_fuel_plan(): FuelPlan
get_stint_plan(): StintPlan
project_pit_window(opts?): { earliestLap, latestLap, recommendedLap, reason }
evaluate_undercut(rivalId): { recommend: 'now'|'later'|'hold', deltaS, undercutGainS, rationale, confidence01 }
get_tire_status(): { perWheel: Tire[], windowStatus, degEstimate, confidence01 }
get_fuel_save_target(): { saveLitersPerLap, coachingHint } | null
```

Each returns structured data with units and confidence. The LLM turns it into a sentence;
it must not recompute or "adjust" the numbers.

## Testing

- Unit tests per function using the worked examples above as fixtures.
- **Replay tests:** feed recorded LMU sessions (from the sim-replay adapter) and assert
  the strategy outputs at known race moments (e.g. fuel-to-finish converges within ±1 lap
  by mid-stint; pit recommendation matches a hand-labeled "correct" call).
- Property tests: monotonicity (more fuel ⇒ not fewer laps remaining), unit sanity, no
  NaN/Infinity, confidence in [0,1].
