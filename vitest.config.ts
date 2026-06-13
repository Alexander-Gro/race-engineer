import { defineConfig } from 'vitest/config';

// Single root Vitest run discovers tests across all workspace packages.
// `passWithNoTests` keeps the empty scaffold green until packages add tests (T0.3+).
export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['packages/**/src/**/*.{test,spec}.ts', 'apps/**/src/**/*.{test,spec}.ts'],
  },
});
