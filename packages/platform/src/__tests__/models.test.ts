import { describe, expect, it } from 'vitest';
import { ModelChecksumError, ModelManager, type ModelSpec } from '../models';
import type { Downloader, FileHasher, FileStore } from '../ports';

const SPEC: ModelSpec = {
  id: 'faster-whisper-small',
  kind: 'stt',
  version: '1.0.0',
  fileName: 'model.bin',
  url: 'https://models.example/whisper-small-1.0.0.bin',
  sha256: 'abc123',
  sizeBytes: 480_000_000,
};

/** In-memory FileStore. POSIX-style join/dirname so paths are deterministic in tests. */
class FakeStore implements FileStore {
  readonly files = new Set<string>();
  readonly dirsMade: string[] = [];
  readonly copied: Array<{ src: string; dest: string }> = [];
  exists = (p: string) => Promise.resolve(this.files.has(p));
  ensureDir = (d: string) => {
    this.dirsMade.push(d);
    return Promise.resolve();
  };
  remove = (p: string) => {
    this.files.delete(p);
    return Promise.resolve();
  };
  copy = (src: string, dest: string) => {
    this.copied.push({ src, dest });
    this.files.add(dest);
    return Promise.resolve();
  };
  join = (...parts: string[]) => parts.join('/');
  dirname = (p: string) => p.split('/').slice(0, -1).join('/');
}

/** Downloader that "writes" the file into the store and records the call. */
const fakeDownloader = (
  store: FakeStore,
  calls: Array<{ url: string; dest: string }>,
): Downloader => ({
  download: (url, dest) => {
    calls.push({ url, dest });
    store.files.add(dest);
    return Promise.resolve();
  },
});

/** Hasher that returns a fixed digest (default: the spec's, i.e. a valid download). */
const fakeHasher = (digest: string): FileHasher => ({ sha256: () => Promise.resolve(digest) });

describe('ModelManager', () => {
  it('version-pins the install path under <modelsDir>/<id>/<version>/<file>', () => {
    const mgr = new ModelManager({
      modelsDir: '/data/models',
      downloader: fakeDownloader(new FakeStore(), []),
      hasher: fakeHasher(SPEC.sha256),
      store: new FakeStore(),
    });
    expect(mgr.installedPath(SPEC)).toBe('/data/models/faster-whisper-small/1.0.0/model.bin');
    expect(mgr.installedPath({ ...SPEC, version: '2.0.0' })).toBe(
      '/data/models/faster-whisper-small/2.0.0/model.bin',
    );
  });

  it('cold start: downloads then verifies the checksum and returns the verified path', async () => {
    const store = new FakeStore();
    const calls: Array<{ url: string; dest: string }> = [];
    const mgr = new ModelManager({
      modelsDir: '/data/models',
      downloader: fakeDownloader(store, calls),
      hasher: fakeHasher(SPEC.sha256),
      store,
    });

    const installed = await mgr.ensureModel(SPEC);

    expect(installed.path).toBe('/data/models/faster-whisper-small/1.0.0/model.bin');
    expect(calls).toEqual([{ url: SPEC.url, dest: installed.path }]);
    expect(store.dirsMade).toContain('/data/models/faster-whisper-small/1.0.0');
    expect(store.files.has(installed.path)).toBe(true);
  });

  it('is idempotent: an already-installed, checksum-valid model does not re-download', async () => {
    const store = new FakeStore();
    store.files.add('/data/models/faster-whisper-small/1.0.0/model.bin');
    const calls: Array<{ url: string; dest: string }> = [];
    const mgr = new ModelManager({
      modelsDir: '/data/models',
      downloader: fakeDownloader(store, calls),
      hasher: fakeHasher(SPEC.sha256), // matches → already installed
      store,
    });

    await mgr.ensureModel(SPEC);
    expect(calls).toEqual([]); // no download
  });

  it('rejects a corrupt download: removes the file and throws ModelChecksumError', async () => {
    const store = new FakeStore();
    const mgr = new ModelManager({
      modelsDir: '/data/models',
      downloader: fakeDownloader(store, []),
      hasher: fakeHasher('deadbeef'), // mismatch
      store,
    });

    await expect(mgr.ensureModel(SPEC)).rejects.toBeInstanceOf(ModelChecksumError);
    // the half-written file is not left behind
    expect(store.files.has('/data/models/faster-whisper-small/1.0.0/model.bin')).toBe(false);
  });

  it('offline bundle: copies from a local path instead of downloading, then verifies', async () => {
    const store = new FakeStore();
    const calls: Array<{ url: string; dest: string }> = [];
    const mgr = new ModelManager({
      modelsDir: '/data/models',
      downloader: fakeDownloader(store, calls),
      hasher: fakeHasher(SPEC.sha256),
      store,
    });

    const installed = await mgr.ensureModel(SPEC, { bundlePath: '/usb/whisper-small.bin' });

    expect(calls).toEqual([]); // no network
    expect(store.copied).toEqual([{ src: '/usb/whisper-small.bin', dest: installed.path }]);
    expect(store.files.has(installed.path)).toBe(true);
  });
});
