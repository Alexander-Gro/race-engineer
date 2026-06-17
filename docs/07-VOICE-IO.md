# 07 — Voice I/O

Voice is the primary interface. This covers capturing the driver's speech (STT),
speaking as the engineer (TTS), the push-to-talk radio, and the audio plumbing that makes
it feel like a real team radio without distracting the driver.

## Design principles

- **Push-to-talk, not always-listening.** Simpler, privacy-friendly, no wake word, no
  false triggers from engine noise. The driver holds a mapped wheel button to talk.
- **Tiered output (see [01](01-ARCHITECTURE.md)).** **Every utterance — proactive call-outs and
  replies — is LLM-generated from data and streamed to TTS** (the north star in [CLAUDE.md](../CLAUDE.md)
  / [06](06-AI-ENGINEER.md)); templated phrasing is a **degraded fallback only** (no model / cost cap /
  offline), not the default. Nothing is pre-rendered.
- **Never block driving.** Audio is queued, preemptible, and ducked sensibly; the
  engineer stays quiet at the worst moments (mid-corner) unless it is urgent.
- **Cloud for quality, local for endurance.** Long races must be runnable cheaply/offline.

## Push-to-talk (PTT) flow

```
button DOWN (mapped wheel button, via Input Manager)
   → play short "radio open" SFX (optional)
   → start mic capture + stream to STT
button UP
   → stop capture; finalize transcript
   → hand transcript to AI Engineer (06)
   → stream reply to TTS; play with radio SFX
```

Modes:
- **Hold-to-talk** (default): talk while held, release to send.
- **Toggle**: press to start, press to stop (useful for long questions / no thumb hold).
- **Barge-in**: pressing PTT while the engineer is talking interrupts TTS playback.

Mapping is configured in settings: "press the button you want to use" → capture device +
button (see [08-INPUT-AND-CONTROLS.md](08-INPUT-AND-CONTROLS.md)). Support multiple
bindings (PTT, "repeat that", "box confirm").

## Speech-to-text (STT)

Requirements: low-latency streaming, robust to wheel/pedal/engine background noise, good
with racing jargon and numbers ("box", "P3", "set TC to four").

| Provider | Notes |
| --- | --- |
| **faster-whisper** (local) | **Default.** Offline, free, ~same accuracy as Whisper; 3–4 GB VRAM or CPU; ~500–800 ms streaming |
| **whisper.cpp** (local) | CPU/portable alternative default |
| **Deepgram** (cloud) | Opt-in BYO-key: fast streaming, good noise handling |
| **OpenAI** (cloud) | Opt-in BYO-key: high accuracy; streaming options |

Tactics:
- Stream while the button is held so the transcript is ready ~instantly on release.
- Optional **domain biasing / keyword hints** (driver names, "box", aid names, numbers).
- Mic selection + input gain + noise gate in settings; push-to-talk already removes most
  false input.

## Text-to-speech (TTS) — the engineer voice

Requirements: natural, low-latency, **streaming** (start speaking before the whole reply
is generated), selectable persona/voice.

| Provider | Notes |
| --- | --- |
| **Piper** (local) | **Default (lightest).** Offline, free, ~10× real-time on CPU; quality below top tier |
| **Kokoro** (local) | **Default (quality).** 82M params, CPU or 1–2 GB VRAM; noticeably better than Piper |
| **ElevenLabs** (cloud) | Opt-in BYO-key: best naturalness, streaming, voice variety |
| **Azure Neural TTS** (cloud) | Opt-in BYO-key: very low latency, many voices |
| **OpenAI TTS** (cloud) | Opt-in BYO-key: good quality, simple |

### Vocal tone — emotion, not just words (the vision)

The engineer must not sound flat and monotone. The AI generates *how a line is felt*, not only what
it says: the model prefixes each spoken line with one **tone tag** — `[calm]`, `[urgent]`, `[upbeat]`,
or `[serious]` — chosen from the live moment (a routine fuel read is `[calm]`; "box this lap" under an
FCY is `[urgent]`; a personal best is `[upbeat]`). The voice layer (`parseToneTag` in
`packages/voice`) strips the tag — it is **never spoken aloud** — and renders the register per provider:

- **Piper (local default):** bends its only prosody knobs — `length_scale` (pace; lower = faster),
  `noise_scale` (pitch/timbre variation), `noise_w` (cadence). Even the neutral `[calm]` runs a brisker
  `length_scale` than Piper's draggy stock 1.0; `[urgent]` is faster and tenser. This is the fix for
  "slow and robotic" on the free path — but Piper has a low ceiling; **Kokoro** (next) and the cloud
  voices are markedly more natural.
- **Cloud (OpenAI `gpt-4o-mini-tts`):** the tone becomes a literal `instructions` string ("speak with
  urgency and tension…") — genuine, audible emotion.

It is **delivery only** — tone never changes the words or a number (the hard rules hold). An untagged
reply (a fallback path, an older model) degrades cleanly to the neutral default. The tag set here must
stay in sync with `VocalTone` (`packages/voice`) and `TONE_TAG_INSTRUCTION` (`packages/ai`).

Tactics:
- **Sentence-streaming:** as Claude streams its first sentence, synthesize and play it
  while the next is generated → shrinks perceived latency dramatically.
- **Radio SFX (F1-broadcast overlay) — implemented.** The engineer voice is routed through a Web
  Audio comms chain in the renderer (`apps/desktop/src/radio-fx.ts`, wired in `wireAudioOut`):
  **bandpass ~350–3500 Hz + light waveshaper grit + heavy compression + a faint static bed**, with a
  short **"roger" beep** opening each *transmission* (a streamed reply is one transmission — the beep
  fires once, not per sentence) — so it reads like a TV team-radio message. PTT adds a **mic-key
  click** on press/release (the key-up/key-down of a transmitter). Pure params/curve are unit-tested;
  the `AudioContext` graph runs only in the renderer and degrades to the clean voice if unavailable.

> **Interim spoken replies (Web Speech API).** Until the local Piper/Kokoro engines + the
> `VoicePlayer`→`AudioSink` byte pipeline land (T10.1 native half), the desktop app speaks the
> engineer's **conversational text-ask reply** aloud via the browser `speechSynthesis` (the OS
> voice) — free, no key, no model download. This path is deliberately **separate** from the tiered
> queue above and is used **only** for the conversational reply; proactive call-outs go through the
> `VoicePlayer` queue path. It's a `SpeechController` over an injected port
> (`apps/desktop/src/speech.ts`), with a mute toggle, degrading to text-only where speech is
> unavailable.

## Audio playback & routing

- **Priority queue.** Each utterance has a priority (conversation reply > warning > strategy >
  chatter). Utterances **queue and play in priority order** — nothing is cut off mid-sentence
  automatically. The only interrupts are the driver keying PTT (barge-in) or an explicit preempt flag.
- **Quiet windows.** Suppress non-urgent speech during high-load moments (heavy braking,
  mid-corner) using telemetry (steering angle, combined g, throttle/brake). Urgent safety
  calls override.
- **Output device selection.** Let the user send engineer audio to a specific device
  (e.g. headset) separate from game audio. We control only our own volume; we cannot
  reliably duck the game's audio, so default to a dedicated output or a comfortable mix.
- **Ducking our own chatter** when the driver presses PTT (the engineer stops talking).

## Local vs cloud mode

A single setting picks the profile:
- **Free (default):** faster-whisper + Piper/Kokoro, fully local and private; pairs with a
  free LLM route (local Qwen / free cloud tier / template mode). $0 marginal cost, works
  offline for voice. This is what ships enabled.
- **Premium (opt-in, BYO-key):** Deepgram/ElevenLabs(or Azure) + a cloud LLM via the user's
  own key. Best experience; metered to the user's account. Surface projected cost in settings.

All providers sit behind `SttProvider` / `TtsProvider` interfaces so they are swappable
and testable with fixtures. See [15-COST-AND-FREE-OPERATION.md](15-COST-AND-FREE-OPERATION.md).

## Interfaces (sketch)

```ts
interface SttProvider {
  startStream(opts: { sampleRate; hints?: string[] }): SttStream; // push audio, get partials+final
}
interface TtsProvider {
  synthesizeStream(text: string, voice: VoiceId): AsyncIterable<AudioChunk>;
  prerender(phrases: string[], voice: VoiceId): Promise<Map<string, AudioRef>>;
}
interface VoicePlayer {
  enqueue(audio: AudioSource, priority: number, opts?: { preempt?: boolean; duckable?: boolean }): void;
  bargeInStop(): void;     // on PTT press
  setOutputDevice(id: string): void;
}
```

## Latency budget (recap)

| Path | Budget | How |
| --- | --- | --- |
| Proactive strategy (Tier 1) | looser — non-reflex | **LLM generates from the event + data** → sentence-streamed TTS (template = degraded fallback) |
| Conversational reply (Tier 2) | < ~2 s to first audio | streaming STT + streaming LLM(+tools) + sentence-streamed TTS |

## Testing

- Latency harness measuring each path end-to-end per provider.
- Noise-robustness check for STT with recorded wheel/pedal/engine backgrounds.
- Priority-queue tests: utterances play in priority order; barge-in stops playback immediately.
