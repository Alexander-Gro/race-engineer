/**
 * A tiny C-struct layout calculator for the rF2 shared-memory buffers.
 *
 * The rF2State.h structs are compiled with `#pragma pack(push, 4)` (see docs/03 §S1), so
 * every member is aligned to `min(naturalAlignment, 4)`. Getting this wrong shifts every
 * offset after the first sub-8-byte field, so we compute offsets here from the declared
 * field order and unit-test the math — the live dump then confirms the bytes match the game.
 *
 * Pure and game-agnostic in mechanism (the rF2-specific field lists live in `structs.ts`).
 */

export const PACK = 4;

/** A primitive scalar kind with its size and natural alignment (bytes). */
export type Scalar = 'f64' | 'f32' | 'i32' | 'u32' | 'i16' | 'u16' | 'i8' | 'u8' | 'u64';

const SCALAR_SIZE: Record<Scalar, number> = {
  f64: 8,
  f32: 4,
  i32: 4,
  u32: 4,
  i16: 2,
  u16: 2,
  i8: 1,
  u8: 1,
  u64: 8,
};

/** A field is a scalar (optionally arrayed), a fixed char buffer, or a nested struct (optionally arrayed). */
export type FieldSpec =
  | { name: string; kind: 'scalar'; scalar: Scalar; count?: number }
  | { name: string; kind: 'chars'; length: number }
  | { name: string; kind: 'struct'; layout: StructLayout; count?: number };

export interface LaidOutField {
  offset: number;
  /** Size of a single element. */
  elementSize: number;
  /** Stride between array elements (== elementSize here; no inter-element padding under packing). */
  stride: number;
  count: number;
  align: number;
}

export interface StructLayout {
  fields: Record<string, LaidOutField>;
  size: number;
  align: number;
}

const alignUp = (offset: number, align: number): number => Math.ceil(offset / align) * align;

const specAlign = (spec: FieldSpec): number => {
  switch (spec.kind) {
    case 'scalar':
      return Math.min(SCALAR_SIZE[spec.scalar], PACK);
    case 'chars':
      return 1;
    case 'struct':
      return spec.layout.align;
  }
};

const specElementSize = (spec: FieldSpec): number => {
  switch (spec.kind) {
    case 'scalar':
      return SCALAR_SIZE[spec.scalar];
    case 'chars':
      return spec.length;
    case 'struct':
      return spec.layout.size;
  }
};

/** Compute the packed (pack=4) layout for an ordered field list. */
export const layoutStruct = (specs: FieldSpec[]): StructLayout => {
  let offset = 0;
  let maxAlign = 1;
  const fields: Record<string, LaidOutField> = {};

  for (const spec of specs) {
    const align = specAlign(spec);
    const elementSize = specElementSize(spec);
    const count = spec.kind === 'chars' ? 1 : (spec.count ?? 1);
    offset = alignUp(offset, align);
    fields[spec.name] = { offset, elementSize, stride: elementSize, count, align };
    offset += elementSize * count;
    maxAlign = Math.max(maxAlign, align);
  }

  return { fields, size: alignUp(offset, maxAlign), align: maxAlign };
};

/** Look up a laid-out field, throwing if the name is unknown (keeps offsets type-safe). */
export const fieldOf = (layout: StructLayout, name: string): LaidOutField => {
  const field = layout.fields[name];
  if (!field) throw new Error(`unknown struct field: ${name}`);
  return field;
};

/** Convenience: the byte offset of a named field. */
export const offsetOf = (layout: StructLayout, name: string): number =>
  fieldOf(layout, name).offset;

// Field-spec constructors (concise, declaration-order helpers for structs.ts).
export const f64 = (name: string, count?: number): FieldSpec => ({
  name,
  kind: 'scalar',
  scalar: 'f64',
  count,
});
export const f32 = (name: string, count?: number): FieldSpec => ({
  name,
  kind: 'scalar',
  scalar: 'f32',
  count,
});
export const i32 = (name: string, count?: number): FieldSpec => ({
  name,
  kind: 'scalar',
  scalar: 'i32',
  count,
});
export const u32 = (name: string, count?: number): FieldSpec => ({
  name,
  kind: 'scalar',
  scalar: 'u32',
  count,
});
export const i16 = (name: string, count?: number): FieldSpec => ({
  name,
  kind: 'scalar',
  scalar: 'i16',
  count,
});
export const u16 = (name: string, count?: number): FieldSpec => ({
  name,
  kind: 'scalar',
  scalar: 'u16',
  count,
});
export const i8 = (name: string, count?: number): FieldSpec => ({
  name,
  kind: 'scalar',
  scalar: 'i8',
  count,
});
export const u8 = (name: string, count?: number): FieldSpec => ({
  name,
  kind: 'scalar',
  scalar: 'u8',
  count,
});
export const u64 = (name: string, count?: number): FieldSpec => ({
  name,
  kind: 'scalar',
  scalar: 'u64',
  count,
});
export const chars = (name: string, length: number): FieldSpec => ({ name, kind: 'chars', length });
export const struct = (name: string, layout: StructLayout, count?: number): FieldSpec => ({
  name,
  kind: 'struct',
  layout,
  count,
});
