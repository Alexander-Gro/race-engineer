import type { Downloader, FileHasher, FileStore } from './ports';

/**
 * Local-model manager (build-plan T4.6, docs/16 §2): first-run **download** (not bundled by
 * default) → **checksum verify** → **version-pinned** install into the user-data dir, with an
 * **offline-bundle** option. Idempotent: an already-installed, checksum-valid model is a no-op.
 *
 * Pure orchestration over injectable ports (download / hash / fs), so the whole flow is tested
 * offline with fakes. Concrete model specs (real URLs + SHA-256) for the free-profile STT/TTS/LLM
 * models are filled in when the native voice/LLM bundles are wired (T10.1).
 */
export type ModelKind = 'stt' | 'tts' | 'llm';

export interface ModelSpec {
  /** Stable id, e.g. `faster-whisper-small`. */
  id: string;
  kind: ModelKind;
  /** Pinned version — part of the install path, so upgrades never overwrite a good install. */
  version: string;
  /** Local file name under the version dir. */
  fileName: string;
  /** Download URL (ignored when an offline `bundlePath` is supplied). */
  url: string;
  /** Expected SHA-256 (lowercase hex). */
  sha256: string;
  /** Size in bytes — for progress and disk-space estimates. */
  sizeBytes: number;
}

export interface InstalledModel {
  spec: ModelSpec;
  /** Absolute path to the verified model file. */
  path: string;
}

export interface EnsureModelOptions {
  /** Offline bundle: copy from this local path instead of downloading. */
  bundlePath?: string;
  onProgress?: (received: number, total: number | null) => void;
}

/** Thrown when a freshly-installed file's checksum doesn't match the pinned spec. */
export class ModelChecksumError extends Error {
  readonly modelId: string;
  readonly expected: string;
  readonly actual: string;
  constructor(spec: ModelSpec, expected: string, actual: string) {
    super(
      `Model "${spec.id}@${spec.version}" failed checksum: expected ${expected}, got ${actual}`,
    );
    this.name = 'ModelChecksumError';
    this.modelId = spec.id;
    this.expected = expected;
    this.actual = actual;
  }
}

export interface ModelManagerOptions {
  /** User-data models root, e.g. `<userData>/models`. */
  modelsDir: string;
  downloader: Downloader;
  hasher: FileHasher;
  store: FileStore;
}

export class ModelManager {
  readonly #dir: string;
  readonly #downloader: Downloader;
  readonly #hasher: FileHasher;
  readonly #store: FileStore;

  constructor(opts: ModelManagerOptions) {
    this.#dir = opts.modelsDir;
    this.#downloader = opts.downloader;
    this.#hasher = opts.hasher;
    this.#store = opts.store;
  }

  /** Version-pinned install path: `<modelsDir>/<id>/<version>/<fileName>`. */
  installedPath(spec: ModelSpec): string {
    return this.#store.join(this.#dir, spec.id, spec.version, spec.fileName);
  }

  /** Installed iff the version-pinned file exists *and* its checksum matches (no silent corruption). */
  async isInstalled(spec: ModelSpec): Promise<boolean> {
    const path = this.installedPath(spec);
    if (!(await this.#store.exists(path))) return false;
    return (await this.#hasher.sha256(path)) === spec.sha256;
  }

  /**
   * Ensure a model is present and verified, returning its path. Downloads (or copies an offline
   * bundle) only when it's missing/invalid; verifies the checksum and removes a corrupt file rather
   * than leaving a half-written one. Idempotent.
   */
  async ensureModel(spec: ModelSpec, opts: EnsureModelOptions = {}): Promise<InstalledModel> {
    const path = this.installedPath(spec);
    if (await this.isInstalled(spec)) return { spec, path };

    await this.#store.ensureDir(this.#store.dirname(path));
    if (opts.bundlePath !== undefined) {
      await this.#store.copy(opts.bundlePath, path);
    } else {
      await this.#downloader.download(spec.url, path, opts.onProgress);
    }

    const actual = await this.#hasher.sha256(path);
    if (actual !== spec.sha256) {
      await this.#store.remove(path);
      throw new ModelChecksumError(spec, spec.sha256, actual);
    }
    return { spec, path };
  }
}
