/**
 * Side-effect ports for the local-model manager (build-plan T4.6, docs/16 §2). The manager's
 * logic — version-pinned paths, checksum verification, idempotent install, route recommendation —
 * is **pure** and depends only on these interfaces, so it is fully unit-testable with in-memory
 * fakes (no network, no filesystem, no GPU). The app supplies the concrete Windows/Node
 * implementations (real `fetch` download, `node:fs`/`node:crypto`, a `nvidia-smi`/`wmic` GPU probe)
 * at runtime — the live half, like the voice native backends (T4.4) and the Electron shell (T6.1).
 *
 * Read-only/advisory project-wide: nothing here touches the game. The model manager only reads
 * model files into the user-data dir.
 */

/** Streams a URL to `dest`, reporting bytes received / total (total null when unknown). */
export interface Downloader {
  download(
    url: string,
    dest: string,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<void>;
}

/** Computes a file's SHA-256 (lowercase hex) — the checksum-verification + version-pin integrity port. */
export interface FileHasher {
  sha256(path: string): Promise<string>;
}

/** Minimal filesystem the manager needs. `join`/`dirname` are ports so the pure logic stays off `node:path`. */
export interface FileStore {
  exists(path: string): Promise<boolean>;
  ensureDir(dir: string): Promise<void>;
  remove(path: string): Promise<void>;
  copy(src: string, dest: string): Promise<void>;
  join(...parts: string[]): string;
  dirname(path: string): string;
}

/** Reads GPU/VRAM/CUDA availability (the live half — `nvidia-smi` / DXGI / `wmic` on Windows). */
export interface GpuProbe {
  detect(): Promise<import('./gpu').GpuInfo>;
}

/** A GET that returns a fetch-like response — used to probe the local Ollama daemon. Injectable for tests. */
export type HttpGetJson = (
  url: string,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
