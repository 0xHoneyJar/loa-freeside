import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // loa:shortcut: isolate:false shares the module registry across test files
    // within a worker (no per-file re-setup) — ~22% faster on this suite.
    // Verified isomorphic: identical 664 passed | 26 skipped, 7 failed files.
    // Ceiling: re-enable if a future test relies on cross-file module isolation.
    isolate: false,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', '**/*.test.ts', 'vitest.config.ts'],
    },
  },
});
