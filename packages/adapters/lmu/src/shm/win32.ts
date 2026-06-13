import koffi from 'koffi';

/**
 * Minimal Win32 FFI for **read-only** access to the rF2 shared-memory maps: OpenFileMapping
 * + MapViewOfFile via koffi (docs/02 stack choice). Windows-only at runtime — koffi loads
 * `kernel32.dll` lazily inside {@link openMappedFile}, so importing this module on macOS for
 * typechecking is harmless; only calling it requires Windows.
 *
 * We open with FILE_MAP_READ and never touch the plugin's write/control buffers — there is
 * no write path (CLAUDE.md rule 5).
 */

const FILE_MAP_READ = 0x0004;

// koffi pointer handles are opaque to us; we only pass them back to koffi/Win32.
type NativePtr = unknown;

interface Kernel32 {
  OpenFileMappingA: (access: number, inheritHandle: number, name: string) => NativePtr;
  MapViewOfFile: (
    handle: NativePtr,
    access: number,
    offsetHigh: number,
    offsetLow: number,
    bytesToMap: number,
  ) => NativePtr;
  UnmapViewOfFile: (address: NativePtr) => number;
  CloseHandle: (handle: NativePtr) => number;
}

let kernel32: Kernel32 | null = null;

const loadKernel32 = (): Kernel32 => {
  if (kernel32) return kernel32;
  const lib = koffi.load('kernel32.dll');
  kernel32 = {
    OpenFileMappingA: lib.func('OpenFileMappingA', 'void*', [
      'uint32',
      'int',
      'str',
    ]) as Kernel32['OpenFileMappingA'],
    MapViewOfFile: lib.func('MapViewOfFile', 'void*', [
      'void*',
      'uint32',
      'uint32',
      'uint32',
      'size_t',
    ]) as Kernel32['MapViewOfFile'],
    UnmapViewOfFile: lib.func('UnmapViewOfFile', 'int', ['void*']) as Kernel32['UnmapViewOfFile'],
    CloseHandle: lib.func('CloseHandle', 'int', ['void*']) as Kernel32['CloseHandle'],
  };
  return kernel32;
};

export interface MappedBuffer {
  /** Copy `size` bytes from the live map into a Buffer. */
  read: (size: number) => Buffer;
  /** Read the [begin, end] version counters (first two uint32) from the live map. */
  readVersion: () => { begin: number; end: number };
  close: () => void;
}

/**
 * Open an existing memory-mapped file by name for reading. Returns null if it does not exist
 * (the game isn't running or the plugin/buffer isn't enabled) — never throws for that case.
 */
export const openMappedFile = (name: string): MappedBuffer | null => {
  const k = loadKernel32();
  const handle = k.OpenFileMappingA(FILE_MAP_READ, 0, name);
  if (!handle) return null;

  const address = k.MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
  if (!address) {
    k.CloseHandle(handle);
    return null;
  }

  return {
    read: (size: number): Buffer => Buffer.from(koffi.decode(address, 'uint8', size) as number[]),
    readVersion: (): { begin: number; end: number } => {
      const pair = koffi.decode(address, 'uint32', 2) as number[];
      return { begin: pair[0] ?? 0, end: pair[1] ?? 0 };
    },
    close: (): void => {
      k.UnmapViewOfFile(address);
      k.CloseHandle(handle);
    },
  };
};
