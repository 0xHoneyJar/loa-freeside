import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Agent subsystem CI — root tests/integration only.
 *
 * RC-3 fix: using `npx vitest run tests/integration/` without --config causes vitest to
 * scan the entire repo matching the path pattern, collecting sietch tests and worktree
 * files (600+ files, all failing). This config scopes collection to the repo-root
 * integration tests only.
 *
 * Excludes themes/sietch (ci.yml owns those) and local agent worktrees under .claude/.
 */
export default defineConfig({
  resolve: {
    alias: {
      zod: path.resolve(__dirname, 'themes/sietch/node_modules/zod'),
      // RC-2 fix: ioredis and pg are not in root node_modules (pnpm workspace isolation).
      // agent-gateway.test.ts dynamically imports ioredis; audit-trail imports pg via db-harness.ts.
      // These tests skip when their services are unavailable (skipIf guards), but the import
      // must resolve at collection time. Alias to sietch node_modules (canonical install location).
      ioredis: path.resolve(__dirname, 'themes/sietch/node_modules/ioredis'),
      pg: path.resolve(__dirname, 'themes/sietch/node_modules/pg'),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    exclude: [
      'themes/**',
      '.claude/**',
      '**/node_modules/**',
    ],
    environment: 'node',
    globals: true,
    server: {
      deps: {
        moduleDirectories: [
          'node_modules',
          path.resolve(__dirname, 'themes/sietch/node_modules'),
        ],
      },
    },
  },
});
