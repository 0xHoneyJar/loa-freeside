import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // F-1 Fix: Resolve @arrakis/adapters to TypeScript source instead of dist/
  // This eliminates manual dist sync for test correctness. Tests always run
  // against fresh TS source; dist-verify.ts validates build artifacts separately.
  resolve: {
    alias: [
      {
        find: /^@arrakis\/adapters\/(.*)/,
        replacement: path.resolve(__dirname, '../../packages/adapters/$1'),
      },
      {
        find: '@arrakis/adapters',
        replacement: path.resolve(__dirname, '../../packages/adapters'),
      },
    ],
  },
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
