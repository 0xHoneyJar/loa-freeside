import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Agent subsystem CI — root tests/unit only.
 * Excludes themes/sietch (ci.yml) and local agent worktrees under .claude/.
 * Resolves bare imports (zod, etc.) from themes/sietch for cross-imported protocol tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      zod: path.resolve(__dirname, 'themes/sietch/node_modules/zod'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
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
