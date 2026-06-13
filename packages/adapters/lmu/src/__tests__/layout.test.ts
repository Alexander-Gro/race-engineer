import { describe, expect, it } from 'vitest';
import { chars, f64, fieldOf, layoutStruct, offsetOf, struct, u32, u8 } from '../shm/layout';

describe('pack(4) layout calculator', () => {
  it('aligns a double to 4 bytes after a single byte (pack=4, not natural 8)', () => {
    const l = layoutStruct([u8('a'), f64('x')]);
    expect(offsetOf(l, 'a')).toBe(0);
    expect(offsetOf(l, 'x')).toBe(4); // natural alignment would be 8; pack(4) gives 4
  });

  it('packs a run of bytes then a double at offset 4', () => {
    const l = layoutStruct([u8('a'), u8('b'), u8('c'), u8('d'), f64('x')]);
    expect(offsetOf(l, 'x')).toBe(4);
  });

  it('lays out scalar arrays with stride = element size', () => {
    const l = layoutStruct([f64('t', 3)]);
    const t = fieldOf(l, 't');
    expect(t.offset).toBe(0);
    expect(t.count).toBe(3);
    expect(t.stride).toBe(8);
    expect(l.size).toBe(24);
  });

  it('treats char buffers as byte-aligned and sizes them by length', () => {
    const l = layoutStruct([u8('a'), chars('name', 3), f64('x')]);
    expect(offsetOf(l, 'name')).toBe(1);
    expect(offsetOf(l, 'x')).toBe(4); // chars end at 4, double aligns to 4
  });

  it('nests structs and arrays of structs', () => {
    const inner = layoutStruct([f64('x'), f64('y')]); // size 16, align 4
    const l = layoutStruct([u32('n'), struct('items', inner, 2)]);
    const items = fieldOf(l, 'items');
    expect(items.offset).toBe(4);
    expect(items.stride).toBe(16);
    expect(items.count).toBe(2);
    expect(l.size).toBe(4 + 32);
  });
});
