import { defineConfig } from 'vitest/config';

export default defineConfig({
  // JSX is transformed to Preact's runtime via the jsx/jsxImportSource settings in
  // tsconfig.json, which Vitest's transformer reads. No extra transform config needed.
  test: {
    // Default to node; DOM-dependent test files opt in via `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/background/**'],
    },
  },
});
