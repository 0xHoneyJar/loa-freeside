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
 *   RPC_URL_<chain>        a JSON-RPC endpoint per chain (e.g. RPC_URL_80094) for block-at-date resolution
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
import { buildAuditApp, configFromEnv } from '../src/server.js';
import { makeSonarOwnershipSource, registryFromMap } from '../src/ownership-source.js';
import { makeRpcBlockTimeResolver } from '../src/block-time-resolver.js';

process.on('unhandledRejection', (reason) => {
  // F9: log AND exit non-zero — a swallowed rejection can leave the process wedged (event loop alive, no
  // longer serving correctly); Railway's healthcheck + restart policy recovers a clean crash, not a zombie.
  console.error('[shadow-audit-api] unhandledRejection — exiting:', reason);
  process.exit(1);
});

// the COLLECTION_REGISTRY values (collection id + token standard) are the most correctness-critical config
// in the deploy — VALIDATE them, the way role-source validates its snapshot (FAGAN MEDIUM-2). A typo'd
// `collection` would match no Transfers → an empty, silently-wrong audit.
const RegistrySchema = z.record(
  z.string(),
  z.object({ collection: z.string().min(1), standard: z.enum(['erc721', 'erc1155']) }).strict(),
);

function loadRegistryFromEnv(): { registry: ReturnType<typeof registryFromMap>; chains: Set<string> } {
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
  return { registry: registryFromMap(map), chains };
}

/** Per-chain JSON-RPC resolver (the RPC endpoint differs per chain). */
function resolverFor(chain: string): BlockTimeResolver {
  const url = process.env[`RPC_URL_${chain}`];
  if (!url) {
    throw new Error(`RPC_URL_${chain} is required (JSON-RPC endpoint for chain ${chain}, for block-at-date resolution)`);
  }
  return makeRpcBlockTimeResolver({ url });
}

// ONE confirmations source for BOTH the SonarClient reorg guard AND the ownership-source "current" block,
// so they can never drift apart (FAGAN MEDIUM-6: split knobs are a latent total-outage landmine).
const confirmations = process.env.CONFIRMATIONS ? Number(process.env.CONFIRMATIONS) : 12;
if (!Number.isInteger(confirmations) || confirmations < 0) {
  throw new Error(`CONFIRMATIONS must be a non-negative integer (got "${process.env.CONFIRMATIONS}")`);
}

const { registry, chains } = loadRegistryFromEnv();
// BOOT-validate an RPC URL for every registry chain — never boot /healthz-green with a chain that fails
// every real audit at request time (FAGAN MEDIUM-3).
const missingRpc = [...chains].filter((c) => !process.env[`RPC_URL_${c}`]);
if (missingRpc.length > 0) {
  throw new Error(`missing JSON-RPC endpoint(s) for registry chain(s): ${missingRpc.map((c) => `RPC_URL_${c}`).join(', ')}`);
}

const sonar = new SonarClient(
  process.env.BELT_GATEWAY_URL ? { endpoint: process.env.BELT_GATEWAY_URL, confirmations } : { confirmations },
  defaultTransferPageFetcher,
);
const ownership = makeSonarOwnershipSource({ sonar, resolverFor, registry, confirmations });
const app = buildAuditApp(ownership, configFromEnv(), registry);

const port = Number.parseInt(process.env.PORT ?? '3040', 10);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[shadow-audit-api] listening on http://0.0.0.0:${info.port} · operated=${process.env.OPERATED_COMMUNITIES ?? '(unset!)'} · key=${process.env.SHADOW_AUDIT_API_KEY ? 'set' : 'OPEN'}`,
  );
});
