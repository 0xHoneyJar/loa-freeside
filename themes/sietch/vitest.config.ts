import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // F-1 Fix: Resolve @freeside/adapters to TypeScript source instead of dist/
  // This eliminates manual dist sync for test correctness. Tests always run
  // against fresh TS source; dist-verify.ts validates build artifacts separately.
  resolve: {
    alias: [
      {
        find: /^@arrakis\/adapters\/(.*)/,
        replacement: path.resolve(__dirname, '../../packages/adapters/$1'),
      },
      {
        find: '@freeside/adapters',
        replacement: path.resolve(__dirname, '../../packages/adapters'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Ensure bare imports from aliased @freeside/* source files resolve correctly.
    // Without this, imports like 'opossum' from packages/adapters/ fail in CI
    // because node_modules only exists in themes/sietch/, not in packages/adapters/.
    server: {
      deps: {
        moduleDirectories: ['node_modules', path.resolve(__dirname, 'node_modules')],
      },
    },
    // opossum is CJS with no `main`/`exports` field, so Node defaults to its index.js,
    // which does `require('./lib/circuit')`. moduleDirectories (above) resolves the bare
    // `opossum` specifier, but Vite's SSR transform then fails on opossum's INTERNAL
    // relative require ("Cannot find module './lib/circuit'") — the error that reds every
    // unit file importing the @freeside/adapters chain. Pre-bundling opossum through
    // esbuild resolves its internals at bundle time, sidestepping the runtime failure.
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['opossum'],
        },
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/types/**/*.ts',
        'src/**/*.d.ts',
        'src/index.ts', // Entry point
        'src/db/migrations/**', // Generated migrations
        'src/ui/**', // React UI — separate test harness
        'src/api/routes/**', // Route handlers — integration-tested
        'src/api/auth/**', // Auth middleware — integration-tested
        'src/api/middleware/**', // Express middleware — integration-tested
        'src/api/server.ts', // Express bootstrap
        'src/api/routes.ts', // Route registration
        'src/api/docs/**', // Swagger/OpenAPI setup
        'src/discord/**', // Discord bot — integration-tested
        'src/telegram/**', // Telegram bot — integration-tested
        'src/jobs/**', // Background jobs — integration-tested
        'src/trigger/**', // Trigger.dev tasks
        'src/config/**', // Config loaders
        'src/static/**', // Static assets
      ],
      thresholds: {
        // Baseline from cycle-045 CI rehabilitation.
        // Actual coverage ~51% — set floor slightly below to avoid flaky CI.
        // TODO: Ratchet upward as test coverage improves.
        lines: 45,
        functions: 55,
        branches: 60,
        statements: 45,
      },
    },
    testTimeout: 10000,
  },
});
