# 07 — Voice I/O

Voice is the primary interface. This covers capturing the driver's speech (STT),
speaking as the engineer (TTS), the push-to-talk radio, and the audio plumbing that makes
it feel like a real team radio without distracting the driver.

## Design principles

- **Push-to-talk, not always-listening.** Simpler, privacy-friendly, no wake word, no
  false triggers from engine noise. The driver holds a mapped wheel button to talk.
- **Tiered output (see [01](01-ARCHITECTURE.md)).** Reflex spotter calls are pre-rendered
  audio; conversational replies stream from TTS. Different budgets, different paths.
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

Tactics:
- **Sentence-streaming:** as Claude streams its first sentence, synthesize and play it
  while the next is generated → shrinks perceived latency dramatically.
- **Pre-rendered Tier-0 library:** synthesize the fixed spotter phrases ("car left", "car
  right", "3-wide", "clear", "P-up", "P-down", common numbers) once, cache as audio
  files, play with near-zero latency. Re-render when the user changes voice.
- **Radio SFX:** band-limit + light noise/compression + open/close clicks to sound like
  a team radio. Subtle; user can disable.

> **Interim spoken replies (Web Speech API).** Until the local Piper/Kokoro engines + the
> `VoicePlayer`→`AudioSink` byte pipeline land (T10.1 native half), the desktop app speaks the
> engineer's **conversational text-ask reply** aloud via the browser `speechSynthesis` (the OS
> voice) — free, no key, no model download. This path is deliberately **separate** from the tiered
> queue above and is used **only** for the conversational reply; Tier-0 spotter/strategy audio still
> goes through the pre-rendered `VoicePlayer` path. It's a `SpeechController` over an injected port
> (`apps/desktop/src/speech.ts`), with a mute toggle, degrading to text-only where speech is
> unavailable.

## Audio playback & routing

- **Priority queue.** Each utterance has a priority (urgent spotter > strategy > chatter).
  Higher priority **preempts** or **ducks** lower; never let a long strategy explanation
  step on a "car left".
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
| Spotter reflex | < 300 ms | pre-rendered clip, no network |
| Templated strategy | < 700 ms | template text → cached/short TTS |
| Conversational reply | < 2 s to first audio | streaming STT + streaming LLM + sentence-streamed TTS |

## Testing

- Latency harness measuring each path end-to-end per provider.
- Noise-robustness check for STT with recorded wheel/pedal/engine backgrounds.
- Priority-queue tests: urgent preempts chatter; barge-in stops playback immediately.
- Pre-render integrity: every Tier-0 phrase has a cached clip for the active voice.
