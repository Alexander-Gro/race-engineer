# Third-party components

Race Engineer is licensed under Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).
This file tracks the licenses and attributions of third-party software and models that the
project **uses or bundles in distributed builds**. Per [docs/16 §7](docs/16-PLATFORM-PREREQUISITES.md),
every component's license must be verified to permit redistribution **before** it is bundled
(vs. downloaded on first run).

Dev-only tooling (TypeScript, ESLint, Prettier, Vitest, tsx, etc.) is not distributed with
the app and is not listed here; see the lockfile for the full dependency tree.

## Bundled runtime dependencies (shipped in the app)

| Component | Version | License | Notes |
| --- | --- | --- | --- |
| [zod](https://github.com/colinhacks/zod) | ^3.24 | MIT | Runtime schema validation (`@race-engineer/core`). |

## Planned bundled / integrated components (verify license before bundling)

These are not in the build yet. Each row must be confirmed (and pinned) before it is bundled
or auto-downloaded. License values below are **to be verified**, not asserted.

| Component | Role | License (verify) | Bundle vs. download | Spike |
| --- | --- | --- | --- | --- |
| rF2 Shared Memory Map plugin (The Iron Wolf) | Telemetry source | TBD — confirm bundle/auto-install rights | Guided install until confirmed | S5 |
| faster-whisper / CTranslate2 | Local STT | verify (MIT-family expected) | Download on first run | S7 |
| Piper | Local TTS | verify (MIT expected) | Download on first run | S7 |
| Kokoro | Local TTS (alt) | verify (Apache-2.0 expected) | Download on first run | S7 |
| Qwen (local LLM, free profile) | Local LLM (Route B) | verify (model-specific terms) | Via Ollama / download | S7 |
| Provider SDKs (e.g. `@anthropic-ai/sdk`) | Cloud AI/STT/TTS (BYO-key) | verify (MIT-family expected) | npm dependency | — |

## Explicitly excluded

| Component | Reason |
| --- | --- |
| XTTS v2 (Coqui) | Coqui Public Model License is **non-commercial** — incompatible with redistribution; excluded ([docs/16 §7](docs/16-PLATFORM-PREREQUISITES.md)). |

> Keep this file in sync as dependencies/models are added. The bundled-license set is also
> a release-gate item for packaging (T10.5).
