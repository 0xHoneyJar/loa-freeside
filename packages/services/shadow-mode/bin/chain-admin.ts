#!/usr/bin/env node
/**
 * chain-admin — operator-only freeze/clear surface (SDD sandwich-line §6a, S2-T2).
 *
 * Authenticated by a DEDICATED CHAIN_ADMIN_TOKEN (distinct from DATABASE_URL —
 * db access alone must NOT suffice for a clear). A clear reopens appends ONLY
 * if the chain verifies green post-repair (the store enforces this); a
 * rationale is mandatory and recorded on the append-only shadow_chain_state row.
 *
 *   chain-admin verify  <chain_id>
 *   chain-admin status  <chain_id>
 *   chain-admin clear   <chain_id> --token <CHAIN_ADMIN_TOKEN> --by <who> --rationale "<why>"
 */

import pg from 'pg';
import { PostgresLedgerStore } from '../src/adapters/postgres-store.js';
import { timingSafeEqual } from 'node:crypto';

function fail(msg: string): never {
  console.error(`chain-admin: ${msg}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, chainId, ...rest] = process.argv.slice(2);
  if (!cmd || !chainId) fail('usage: chain-admin <verify|status|clear> <chain_id> [--by <who> --rationale <why>]');

  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) fail('DATABASE_URL required');

  const pool = new pg.Pool({ connectionString: dbUrl });
  const store = new PostgresLedgerStore(pool);
  try {
    if (cmd === 'verify') {
      const verdict = await store.verifyChain(chainId);
      console.log(JSON.stringify(verdict));
      process.exit(verdict.ok ? 0 : 1);
    }
    if (cmd === 'status') {
      console.log(JSON.stringify({ chain_id: chainId, frozen: await store.isChainFrozen(chainId) }));
      process.exit(0);
    }
    if (cmd === 'clear') {
      // The one destructive/recovery capability: a dedicated token, NOT db access.
      // The dedicated secret (distinct from DATABASE_URL). Presented via a second
      // env var so it never appears in argv / process listings (FAGAN S2).
      const expected = process.env.CHAIN_ADMIN_TOKEN?.trim();
      const presented = process.env.CHAIN_ADMIN_TOKEN_PRESENTED?.trim();
      if (!expected) fail('CHAIN_ADMIN_TOKEN must be set for clear (db access alone does not suffice)');
      if (!presented || !timingSafeEqualStr(presented, expected)) {
        fail('clear denied: CHAIN_ADMIN_TOKEN_PRESENTED does not match CHAIN_ADMIN_TOKEN');
      }
      const by = argValue(rest, '--by');
      const rationale = argValue(rest, '--rationale');
      if (!by || !rationale) fail('clear requires --by <who> and --rationale "<why>"');
      await store.clearChainFreeze(chainId, by, rationale); // throws if chain still fails verification
      console.log(JSON.stringify({ cleared: true, chain_id: chainId, by }));
      process.exit(0);
    }
    fail(`unknown command: ${cmd}`);
  } finally {
    await pool.end();
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((err) => {
  console.error(`chain-admin: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
