import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/types/**/*.ts',
        'src/**/*.d.ts',
        'src/index.ts', // Entry point
        'src/db/migrations/**', // Generated migrations
      ],
      thresholds: {
        // Sprint 52: Set coverage threshold to 80%
        lines: 80,
        functions: 80,
        branches: 75, // Slightly lower for complex branching
        statements: 80,
      },
    },
    testTimeout: 10000,
  },
});
