/**
 * Sprint 2 / S2-T2 — the shadow-audit-api server entry. Constructs the real chain ownership adapter from
 * the environment, builds the audit Hono app, and serves it via @hono/node-server (mirrors
 * apps/freeside-operator-dash/bin/http.ts). This is the deployable surface the freeside-dashboard's
 * already-built dormant client (`GET ${SHADOW_AUDIT_API_URL}/v1/audit`) consumes once its env is pointed
 * here.
 *
 * Required env (the server FAILS LOUD at boot / first request on a missing value — never a silently
 * half-wired audit):
 *   OPERATED_COMMUNITIES   comma-separated community names this deploy audits (dogfood-full)
 *   CTA_PRODUCT, CTA_CONVERSATION   the product + conversation door URLs
 *   COLLECTION_REGISTRY    JSON: { "<chain>/<contract>": { "collection": "<belt-gateway id>", "standard": "erc721"|"erc1155" } }
 *                          Entries sharing a `collection` id are ONE collection deployed on several chains
 *                          (S5-T3): an audit addressed at any of them reconstructs the UNION of all of them,
 *                          and refuses outright if any one is unreachable. Chains are NUMERIC ids ("1",
 *                          "80094") — the same id the sonar query is scoped by.
 *   RPC_URL_<chain>        JSON-RPC endpoint(s) per chain for block-at-date resolution. ONE url, or a
 *                          COMMA-SEPARATED failover pool tried in order with retry+backoff (S5-T2 — the
 *                          free endpoints each fail in their own way; there is no paid key). e.g.
 *                          RPC_URL_1="https://ethereum-rpc.publicnode.com,https://eth.drpc.org"
 * Optional:
 *   SHADOW_AUDIT_API_KEY   the X-API-Key the dashboard sends (when unset the aggregate is open)
 *   BELT_GATEWAY_URL       sonar GraphQL endpoint (defaults to belt-gateway-production)
 *   ROLE_SNAPSHOT_PATH     path to the Discord role export JSON · AUDIT_K · PORT
 *
 * ⚠ LIVE CORRECTNESS is operator-gated: the COLLECTION_REGISTRY values + the RPC endpoints drive the
 * ownership reconstruction (money/ops). Run `pnpm -C packages/adapters test:live` + a block-at-date
 * spot-check against the configured RPC before trusting production output.
 */
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { SonarClient, defaultTransferPageFetcher, type BlockTimeResolver } from '@freeside/adapters/sonar';
import { buildAuditApp, configFromEnv, validateApiKeyEnv } from '../src/server.js';
import { makeSonarOwnershipSource, type CollectionRef } from '../src/ownership-source.js';
import { loadRegistry } from '../src/collection-sot.js';
import { readFileSync } from 'node:fs';
import { makeRpcBlockTimeResolver } from '../src/block-time-resolver.js';
import { parseRpcUrls } from '../src/rpc-pool.js';
import {
  connectPostgresRoleSnapshotRepository,
  makeRepositoryRoleStore,
  type PostgresRoleSnapshotConnection,
} from '../src/role-store-postgres.js';

process.on('unhandledRejection', (reason) => {
  // F9: log AND exit non-zero — a swallowed rejection can leave the process wedged (event loop alive, no
  // longer serving correctly); Railway's healthcheck + restart policy recovers a clean crash, not a zombie.
  console.error('[shadow-audit-api] unhandledRejection — exiting:', reason);
  process.exit(1);
});

// §12.3: fail-closed — refuse startup when SHADOW_AUDIT_API_KEY is absent/empty.
// For local dev only: SHADOW_AUDIT_ALLOW_ANON=dev-only (never in production).
try {
  validateApiKeyEnv(process.env);
} catch (err) {
  console.error('[shadow-audit-api] FATAL:', (err as Error).message);
  process.exit(1);
}

// the COLLECTION_REGISTRY values (collection id + token standard) are the most correctness-critical config
// in the deploy — VALIDATE them, the way role-source validates its snapshot (FAGAN MEDIUM-2). A typo'd
// `collection` would match no Transfers → an empty, silently-wrong audit.
const RegistrySchema = z.record(
  z.string(),
  z.object({ collection: z.string().min(1), standard: z.enum(['erc721', 'erc1155']) }).strict(),
);

function loadRegistryFromEnv(): { map: Record<string, CollectionRef>; chains: Set<string> } {
  const raw = process.env.COLLECTION_REGISTRY;
  if (!raw) {
    throw new Error('COLLECTION_REGISTRY is required (JSON map "<chain>/<contract>" → { collection, standard })');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`COLLECTION_REGISTRY is not valid JSON: ${(e as Error).message}`);
  }
  const map = RegistrySchema.parse(parsed); // throws on a bad collection/standard
  const chains = new Set<string>();
  for (const key of Object.keys(map)) {
    const chain = key.split('/')[0];
    if (chain) chains.add(chain);
  }
  // Entries sharing a `collection` id ARE one collection on several chains (S5-T3) — the index groups them
  // into the source set the audit reconstructs as a union. Two rows with the SAME chain+contract but
  // different collection ids would be a config defect; the map key makes that unrepresentable.
  return { map, chains };
}

/** Per-chain JSON-RPC resolver (the RPC endpoint differs per chain). A comma-separated value is a
 *  FAILOVER POOL — the free endpoints each fail in their own way and no paid key is available (S5-T2). */
function resolverFor(chain: string): BlockTimeResolver {
  const url = process.env[`RPC_URL_${chain}`];
  if (!url) {
    throw new Error(`RPC_URL_${chain} is required (JSON-RPC endpoint(s) for chain ${chain}, for block-at-date resolution)`);
  }
  return makeRpcBlockTimeResolver({ url });
}

// ONE confirmations source for BOTH the SonarClient reorg guard AND the ownership-source "current" block,
// so they can never drift apart (FAGAN MEDIUM-6: split knobs are a latent total-outage landmine).
const confirmations = process.env.CONFIRMATIONS ? Number(process.env.CONFIRMATIONS) : 12;
if (!Number.isInteger(confirmations) || confirmations < 0) {
  throw new Error(`CONFIRMATIONS must be a non-negative integer (got "${process.env.CONFIRMATIONS}")`);
}

// Settle gate (collections-sot §6): read the RATIFIED ledger snapshot by default;
// COLLECTION_REGISTRY env is a deprecated break-glass override (wins if set).
const collapse = loadRegistry({
  envRegistry: process.env.COLLECTION_REGISTRY,
  snapshotJson: process.env.COLLECTION_SNAPSHOT_PATH
    ? readFileSync(process.env.COLLECTION_SNAPSHOT_PATH, 'utf8')
    : undefined,
  registryFromEnv: (raw) => {
    process.env.COLLECTION_REGISTRY = raw; // loadRegistryFromEnv reads process.env
    return loadRegistryFromEnv();
  },
});
const { registry, sources, chains } = collapse;
if (collapse.included.length > 0 || Object.keys(collapse.excluded).length > 0) {
  console.error(
    `[shadow-audit-api] settle gate: serving ${collapse.included.length} ratified collection(s); ` +
      `withheld ${Object.keys(collapse.excluded).length} (${JSON.stringify(collapse.excluded)})`,
  );
}
// BOOT-validate an RPC URL for every registry chain — never boot /healthz-green with a chain that fails
// every real audit at request time (FAGAN MEDIUM-3). S5-T2: the value may be a comma-separated failover
// pool, so validate that each chain resolves to >= 1 well-formed endpoint (a typo'd URL fails HERE, not at
// the first audit).
const badRpc: string[] = [];
for (const c of chains) {
  const raw = process.env[`RPC_URL_${c}`] ?? '';
  try {
    if (parseRpcUrls(raw).length === 0) badRpc.push(`RPC_URL_${c} (unset or empty)`);
  } catch (e) {
    badRpc.push(`RPC_URL_${c} (${(e as Error).message})`);
  }
}
if (badRpc.length > 0) {
  throw new Error(`missing/invalid JSON-RPC endpoint(s) for registry chain(s): ${badRpc.join(', ')}`);
}

const sonar = new SonarClient(
  process.env.BELT_GATEWAY_URL ? { endpoint: process.env.BELT_GATEWAY_URL, confirmations } : { confirmations },
  defaultTransferPageFetcher,
);
const ownership = makeSonarOwnershipSource({ sonar, resolverFor, registry, confirmations });
const config = configFromEnv();
let postgresConnection: PostgresRoleSnapshotConnection | undefined;
let roleStore;
if (config.ingestToken && config.roleSnapshotStore === 'postgres') {
  const community = config.operatedCommunities[0];
  if (!community || !config.databaseUrl) {
    throw new Error('Postgres role-store configuration is incomplete');
  }
  postgresConnection = connectPostgresRoleSnapshotRepository(config.databaseUrl);
  await postgresConnection.repository.initialize();
  roleStore = makeRepositoryRoleStore({ repository: postgresConnection.repository, community, sources });
}
const app = buildAuditApp(ownership, config, { registry, sources }, { roleStore });

const port = Number.parseInt(process.env.PORT ?? '3040', 10);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[shadow-audit-api] listening on http://0.0.0.0:${info.port} · operated=${process.env.OPERATED_COMMUNITIES ?? '(unset!)'} · key=${process.env.SHADOW_AUDIT_API_KEY ? 'set' : 'OPEN'}`,
  );
});

let shutdownStarted = false;
async function shutdown(signal: 'SIGTERM' | 'SIGINT'): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`[shadow-audit-api] ${signal}: draining HTTP requests`);

  const forceExit = setTimeout(() => {
    console.error('[shadow-audit-api] graceful shutdown timed out');
    process.exit(1);
  }, 5_000);
  forceExit.unref();

  try {
    // Stop accepting new work and wait for active requests before closing the database they may still use.
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await postgresConnection?.close();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error(
      `[shadow-audit-api] graceful shutdown failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
    );
    clearTimeout(forceExit);
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}
