import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG, modelCatalogFor, providerUsesModel } from './model-catalog';
import { LLM_PROVIDER_IDS } from './settings';

describe('MODEL_CATALOG', () => {
  it('covers exactly the set of LLM provider ids (no drift, no extras)', () => {
    expect(Object.keys(MODEL_CATALOG).sort()).toEqual([...LLM_PROVIDER_IDS].sort());
    for (const id of LLM_PROVIDER_IDS) expect(modelCatalogFor(id)).toBeDefined();
  });

  it('gives every keyed provider a non-empty default + hint; only template has no model', () => {
    for (const id of LLM_PROVIDER_IDS) {
      const entry = modelCatalogFor(id);
      expect(entry.hint).not.toBe('');
      if (id === 'template') {
        expect(entry.default).toBeNull();
        expect(providerUsesModel(id)).toBe(false);
      } else {
        expect(entry.default).toBeTruthy();
        expect(providerUsesModel(id)).toBe(true);
      }
    }
  });

  it("lists each provider's own default among its suggestions (so blank-field == top hint)", () => {
    for (const id of LLM_PROVIDER_IDS) {
      const entry = modelCatalogFor(id);
      if (entry.default) expect(entry.suggestions).toContain(entry.default);
    }
  });
});
