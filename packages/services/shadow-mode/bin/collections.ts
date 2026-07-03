#!/usr/bin/env node
/**
 * collections — the agent-first distiller CLI (SDD collections-sot §3–§8).
 *
 *   collections sync                 derive belt+ERC-165+world (READ-only); prints the ratifiable diff
 *   collections propose  [--yes]     append born-low observations to the ledger
 *   collections ratify <entity_id> <label> <value> [--by <who>] [--yes]
 *                                    flip a SUBJECTIVE label ai-derived→operator-validated (cockpit grant)
 *   collections query "<q>" [--show-contested]   lexical query with provenance badges (READ-only)
 *   collections drift    [--yes]     re-derive + classify; non-zero on contested/orphaned
 *   collections export-snapshot      emit the ratified snapshot JSON for the shadow-audit settle gate
 *
 * Read verbs need only belt+RPC config. Mutating verbs (propose/ratify/drift)
 * need a writable DATABASE_URL and refuse a prod/CI context without --yes
 * (IMP-008). All JSON to stdout (agent-consumable); status to stderr.
 */

import pg from 'pg';
import { PostgresLedgerStore } from '../src/adapters/postgres-store.js';
import { collectionProducerGrant } from '../src/auth/append-grant.js';
import { ground } from '../src/collections/distiller.js';
import { proposeAll } from '../src/collections/propose.js';
import { ratifyCollectionLabel } from '../src/collections/ratify.js';
import { queryCollections } from '../src/collections/query.js';
import { drift } from '../src/collections/drift.js';
import { exportRatifiedSnapshot } from '../src/collections/export-snapshot.js';
import { liveBeltRead, liveEthCall } from '../src/collections/live-clients.js';
import type { CollectionLabelName } from '@freeside/shadow-mode-protocol';

function fail(msg: string): never {
  console.error(`collections: ${msg}`);
  process.exit(2);
}
function nowIso(): string {
  return new Date().toISOString();
}
function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

/** Collect RPC_URL_<chain> env into a per-chain map. */
function rpcUrlsFromEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    const m = k.match(/^RPC_URL_(\d+)$/);
    if (m && v) out[m[1]!] = v;
  }
  return out;
}

function groundDeps() {
  return {
    belt: liveBeltRead(process.env.BELT_GATEWAY_URL),
    ethCall: liveEthCall(rpcUrlsFromEnv()),
  };
}

/** Mutating-command guard (IMP-008): a writable store + a prod-context confirmation. */
function assertMutable(yes: boolean): pg.Pool {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) fail('mutating verb requires DATABASE_URL (a writable ledger)');
  const prod = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';
  if (prod && !yes) fail('refusing to mutate a production ledger without --yes');
  return new pg.Pool({ connectionString: dbUrl });
}

async function withStore<T>(pool: pg.Pool, fn: (s: PostgresLedgerStore) => Promise<T>): Promise<T> {
  const store = new PostgresLedgerStore(pool);
  await store.migrate();
  try {
    return await fn(store);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const [cmd, ...argv] = process.argv.slice(2);
  const yes = hasFlag(argv, '--yes');

  switch (cmd) {
    case 'sync': {
      const derived = await ground(groundDeps());
      process.stdout.write(JSON.stringify({ derived, count: derived.length }, null, 2) + '\n');
      // exit 0; the caller ratifies via `ratify`. (Coherence vs the ledger is `drift`.)
      break;
    }
    case 'propose': {
      const pool = assertMutable(yes);
      const derived = await ground(groundDeps());
      const results = await withStore(pool, (s) => proposeAll(s, collectionProducerGrant(), derived, nowIso()));
      process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
      break;
    }
    case 'ratify': {
      const [entityId, label, value] = argv.filter((a) => !a.startsWith('--'));
      if (!entityId || !label || !value) fail('usage: ratify <entity_id> <label> <value> [--by <who>] [--yes]');
      const byIdx = argv.indexOf('--by');
      const ratifiedBy = byIdx >= 0 ? argv[byIdx + 1]! : 'operator';
      const pool = assertMutable(yes);
      const result = await withStore(pool, (s) =>
        ratifyCollectionLabel(s, collectionProducerGrant(), { entity_id: entityId, label: label as CollectionLabelName, value, ratified_by: ratifiedBy }, nowIso()),
      );
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (!result.ok) process.exit(1);
      break;
    }
    case 'query': {
      const q = argv.find((a) => !a.startsWith('--')) ?? '';
      const dbUrl = process.env.DATABASE_URL?.trim();
      if (!dbUrl) fail('query requires DATABASE_URL');
      const hits = await withStore(new pg.Pool({ connectionString: dbUrl }), (s) =>
        queryCollections(s, q, { showContested: hasFlag(argv, '--show-contested') }),
      );
      process.stdout.write(JSON.stringify({ hits, count: hits.length }, null, 2) + '\n');
      break;
    }
    case 'drift': {
      const pool = assertMutable(yes);
      const report = await withStore(pool, (s) => drift(s, collectionProducerGrant(), groundDeps(), nowIso()));
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      if (report.failed) process.exit(1);
      break;
    }
    case 'export-snapshot': {
      const dbUrl = process.env.DATABASE_URL?.trim();
      if (!dbUrl) fail('export-snapshot requires DATABASE_URL');
      const snapshot = await withStore(new pg.Pool({ connectionString: dbUrl }), (s) => exportRatifiedSnapshot(s));
      process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
      break;
    }
    default:
      fail('usage: collections <sync|propose|ratify|query|drift|export-snapshot> [...]');
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
