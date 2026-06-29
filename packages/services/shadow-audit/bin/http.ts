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
import { SonarClient, defaultTransferPageFetcher, type BlockTimeResolver } from '@freeside/adapters/sonar';
import { buildAuditApp, configFromEnv } from '../src/server.js';
import { makeSonarOwnershipSource, registryFromMap, type CollectionRef } from '../src/ownership-source.js';
import { makeRpcBlockTimeResolver } from '../src/block-time-resolver.js';

process.on('unhandledRejection', (reason) => {
  console.error('[shadow-audit-api] unhandledRejection:', reason);
});

function loadRegistryFromEnv() {
  const raw = process.env.COLLECTION_REGISTRY;
  if (!raw) {
    throw new Error('COLLECTION_REGISTRY is required (JSON map "<chain>/<contract>" → { collection, standard })');
  }
  let parsed: Record<string, CollectionRef>;
  try {
    parsed = JSON.parse(raw) as Record<string, CollectionRef>;
  } catch (e) {
    throw new Error(`COLLECTION_REGISTRY is not valid JSON: ${(e as Error).message}`);
  }
  return registryFromMap(parsed);
}

/** Per-chain JSON-RPC resolver (the RPC endpoint differs per chain). */
function resolverFor(chain: string): BlockTimeResolver {
  const url = process.env[`RPC_URL_${chain}`];
  if (!url) {
    throw new Error(`RPC_URL_${chain} is required (JSON-RPC endpoint for chain ${chain}, for block-at-date resolution)`);
  }
  return makeRpcBlockTimeResolver({ url });
}

const sonar = new SonarClient(
  process.env.BELT_GATEWAY_URL ? { endpoint: process.env.BELT_GATEWAY_URL } : {},
  defaultTransferPageFetcher,
);
const ownership = makeSonarOwnershipSource({ sonar, resolverFor, registry: loadRegistryFromEnv() });
const app = buildAuditApp(ownership, configFromEnv());

const port = Number.parseInt(process.env.PORT ?? '3040', 10);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[shadow-audit-api] listening on http://0.0.0.0:${info.port} · operated=${process.env.OPERATED_COMMUNITIES ?? '(unset!)'} · key=${process.env.SHADOW_AUDIT_API_KEY ? 'set' : 'OPEN'}`,
  );
});
