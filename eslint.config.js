import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Flat config (ESLint v9). Type-aware linting is intentionally NOT enabled yet —
// the non-type-checked recommended set keeps lint fast and avoids project-service
// setup on the empty scaffold. Revisit if/when rules need type information.
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/*.tsbuildinfo'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },
  // Must come last: turns off rules that conflict with Prettier formatting.
  prettier,
);
