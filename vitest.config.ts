import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
    },
  },
  resolve: {
    // Mirrors WXT's module resolution so imports from src/ work in tests.
    extensions: ['.ts', '.js', '.json'],
  },
});
