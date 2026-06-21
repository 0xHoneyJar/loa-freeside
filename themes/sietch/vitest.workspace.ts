import { defineWorkspace } from 'vitest/config';
import path from 'node:path';
import quarantine from './tests/quarantine.generated.json';

/**
 * Vitest Workspace Configuration — Cycle 042 · Sprint-1 T4 (quarantine)
 *
 * Four test projects:
 *   - unit: *.test.ts (excludes *.integration.test.ts, *.e2e.test.ts, tests/integration/, tests/e2e/)
 *   - integration: *.integration.test.ts + tests/integration/*.test.ts (requires Redis via REDIS_URL)
 *   - e2e: *.e2e.test.ts + tests/e2e/ (run via run-e2e.sh)
 *   - quarantine: ONLY the manifest's proven-STRANDED files (FR-1) — runs + reports
 *     but is NOT required. The required unit/integration projects EXCLUDE these so
 *     the gate is honestly green. The exclude list is derived from the extraction
 *     manifest (tools/extraction/extraction-manifest.yaml quarantine[]) via
 *     tools/quarantine/sync-vitest.mjs → tests/quarantine.generated.json. The
 *     anti-masking teeth live in tools/quarantine/gate.sh (signature gate), NOT here.
 *
 * See SDD §3.2 for classification rationale.
 */

// Files the required suite must NOT run (proven-STRANDED, manifest-derived).
const QUARANTINED: string[] = quarantine.files;

const sharedResolve = {
  alias: [
    {
      find: /^@arrakis\/core\/(.*)/,
      replacement: path.resolve(__dirname, '../../packages/core/$1'),
    },
    {
      find: '@freeside/core',
      replacement: path.resolve(__dirname, '../../packages/core'),
    },
    {
      find: /^@arrakis\/adapters\/(.*)/,
      replacement: path.resolve(__dirname, '../../packages/adapters/$1'),
    },
    {
      find: '@freeside/adapters',
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
        ...QUARANTINED, // FR-1: proven-STRANDED files (manifest-derived) stay out of required CI
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
      exclude: [...QUARANTINED], // FR-1: stranded integration files excluded from required CI
      environment: 'node',
      testTimeout: 30000,
    },
    resolve: sharedResolve,
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'quarantine',
      // ONLY the manifest's proven-STRANDED files. Runs + reports; NOT required.
      // passWithNoTests so an empty quarantine list is green, not an error.
      include: QUARANTINED,
      passWithNoTests: true,
      environment: 'node',
      setupFiles: ['./tests/setup-unit.ts'],
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
