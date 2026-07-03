import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The shadow-mode building is READ-ONLY (NFR-4). Its source may import ONLY:
 *  - relative modules (./...)
 *  - node builtins (node:...)
 *  - its own protocol + the reused shadow-audit protocol
 *  - hono (HTTP edge) / zod (validation)
 * Anything else (a Discord write client, role dispenser, identity-api write,
 * sonar write) is a forbidden mutation-capable upstream dependency.
 */
const ALLOWED_BARE_IMPORTS = new Set([
  '@freeside/shadow-mode-protocol',
  '@freeside/shadow-audit-protocol',
  'hono',
  'zod',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const rx = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(source)) !== null) specs.push(m[1]!);
  return specs;
}

describe('AC-7 read-only boundary', () => {
  it('no source file imports a non-allowlisted (mutation-capable) upstream client', async () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        const isLocal = spec.startsWith('.') || spec.startsWith('node:');
        const bare = spec.replace(/^(@[^/]+\/[^/]+|[^/]+).*$/, '$1');
        if (!isLocal && !ALLOWED_BARE_IMPORTS.has(bare)) {
          offenders.push(`${file}: ${spec}`);
        }
      }
    }
    expect(offenders, `forbidden imports:\n${offenders.join('\n')}`).toHaveLength(0);
  });

  it('the ledger store port exposes no upstream-mutation method', async () => {
    const methods = Object.getOwnPropertyNames(InMemoryLedgerStore.prototype);
    const forbidden = /discord|role.?(grant|assign|dispense|mutate|write)|identity.*write|sonar.*write|publish|emit/i;
    const leaks = methods.filter((m) => forbidden.test(m));
    expect(leaks, `unexpected mutation-capable methods: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
