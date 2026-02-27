import { defineWorkspace } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest Workspace Configuration — Cycle 042
 *
 * Three test projects classified by file suffix AND directory:
 *   - unit: *.test.ts (excludes *.integration.test.ts, *.e2e.test.ts, tests/integration/, tests/e2e/)
 *   - integration: *.integration.test.ts + tests/integration/*.test.ts (requires Redis via REDIS_URL)
 *   - e2e: *.e2e.test.ts + tests/e2e/ (run via run-e2e.sh)
 *
 * See SDD §3.2 for classification rationale.
 */

const sharedResolve = {
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
};

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/**/*.test.ts'],
      exclude: [
        'tests/**/*.integration.test.ts',
        'tests/**/*.e2e.test.ts',
        'tests/integration/**',
        'tests/e2e/**',
      ],
      environment: 'node',
      setupFiles: ['./tests/setup-unit.ts'],
    },
    resolve: sharedResolve,
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      include: ['tests/**/*.integration.test.ts', 'tests/integration/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30000,
    },
    resolve: sharedResolve,
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'e2e',
      include: ['tests/**/*.e2e.test.ts'],
      root: path.resolve(__dirname, '../../'),
      environment: 'node',
      testTimeout: 120000,
    },
    resolve: sharedResolve,
  },
]);
