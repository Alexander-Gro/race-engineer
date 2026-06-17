# Build resources (electron-builder)

electron-builder's `buildResources` directory for packaging the Windows app (see
`../electron-builder.yml` and docs/16). Committed (unlike `build/`, which is gitignored).

- **`icon.ico` / `icon.png`** — the app + installer icon (a steering-wheel mark on a carbon tile),
  **generated** by `make-icon.mjs` (pure Node + zlib, no external tools). Regenerate with
  `node build-resources/make-icon.mjs`; electron-builder auto-picks `icon.ico`.
- **`make-icon.mjs`** — the reproducible icon generator. Tweak the palette/geometry constants at the
  top and re-run to rebrand.
- **`win-extra/`** — files copied **next to the installed `.exe`**. Put **`SDL2.dll`** here so wheel
  push-to-talk works in the packaged app (the input backend loads `SDL2.dll` from the exe directory
  by default; `ENGINEER_SDL2_DLL` overrides the path for dev runs). Committed (with a `.gitkeep`) so
  the build doesn't fail when empty.

Not bundled here (deliberately): the **voice models** (Piper `.onnx`, whisper.cpp `.bin`, Kokoro's
self-downloaded model) and the **local LLM** (Ollama) — fetched/configured at runtime (docs/15,
docs/16 §S7) to keep the installer small and licensing clean.
