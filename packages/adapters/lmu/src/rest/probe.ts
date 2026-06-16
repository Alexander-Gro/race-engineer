/**
 * Tolerant field probing for raw LMU REST payloads (build-plan S2/S3/S4). The exact JSON field names
 * are **LIVE-VERIFY** (only the running game's Swagger is authoritative, docs/03 §S2), so REST mappers
 * search a documented set of candidate keys rather than hard-coding one shape, and degrade to `null`
 * when nothing matches — never inventing a value. Shared by the Virtual-Energy and aids mappers.
 * Read-only: these only read payloads the GET-only client already fetched.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const finiteNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Find a finite number under any of `keys` (case-insensitive) at the top level or one level deep.
 * Returns the first match in object-key order, or null. Tolerant of the unknown payload shape.
 */
export const findNumber = (raw: unknown, keys: readonly string[]): number | null => {
  if (!isRecord(raw)) return null;
  const want = new Set(keys.map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(raw)) {
    if (want.has(k.toLowerCase())) {
      const n = finiteNumber(v);
      if (n !== null) return n;
    }
  }
  // One level of nesting (e.g. { virtualEnergy: { level: 85 } } or { aids: { tc: 4 } }).
  for (const v of Object.values(raw)) {
    if (isRecord(v)) {
      const nested = findNumber(v, keys);
      if (nested !== null) return nested;
    }
  }
  return null;
};

/**
 * Find a nested **object** under any of `keys` (case-insensitive) at the top level or one level deep.
 * Used to locate a specific record (e.g. LMU's `garage.VM_TRACTIONCONTROLMAP` aid object, which carries
 * its own `value`/`minValue`/`maxValue`) rather than a bare number — a plain `findNumber(garage,'value')`
 * would grab the first of many same-named fields. Returns the first match, or null.
 */
export const findRecord = (
  raw: unknown,
  keys: readonly string[],
): Record<string, unknown> | null => {
  if (!isRecord(raw)) return null;
  const want = new Set(keys.map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(raw)) {
    if (want.has(k.toLowerCase()) && isRecord(v)) return v;
  }
  for (const v of Object.values(raw)) {
    if (isRecord(v)) {
      const nested = findRecord(v, keys);
      if (nested !== null) return nested;
    }
  }
  return null;
};
