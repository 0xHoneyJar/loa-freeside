import { defineConfig } from 'vitest/config';

/**
 * Agent subsystem CI — root tests/unit only.
 * Excludes themes/sietch (ci.yml) and local agent worktrees under .claude/.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: [
      'themes/**',
      '.claude/**',
      '**/node_modules/**',
    ],
    environment: 'node',
    globals: true,
  },
});
