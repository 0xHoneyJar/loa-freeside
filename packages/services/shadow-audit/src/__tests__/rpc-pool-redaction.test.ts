import { describe, it, expect } from 'vitest';
import { makeRpcPool, redactEndpoints } from '../rpc-pool.js';
import { runAudit, type OwnershipSource, type RoleSource, type WhaleSource } from '../audit-service.js';
import type { SourceResolver } from '../collection-union.js';
import type { Order } from '@freeside/shadow-audit-protocol';

/**
 * SECURITY — arrakis-qf5kc (audit gate, sprint-5). HIGH.
 *
 * The pool used to build its failure message as `${url}: ${message}` for every endpoint. That error
 * propagates: ownership reconstruction catches it and builds a typed refusal whose reason echoes
 * `e.message` — and the router returns that refusal VERBATIM to the caller, including on the ANONYMOUS
 * public teaser (`/v1/access-risk`). So every configured RPC endpoint URL was disclosed to an
 * unauthenticated stranger whenever all endpoints for a chain failed — and an attacker can FORCE that by
 * hammering until the free tiers throttle.
 *
 * It leaked nothing while the endpoints were keyless. It becomes CREDENTIAL DISCLOSURE the moment a paid
 * key is configured — and every paid provider puts the key IN THE URL (alchemy.com/v2/<KEY>,
 * infura.io/v3/<KEY>, quicknode's token). A booby trap that arms itself on the most natural config change.
 *
 * Third finding in this cycle where the SUCCESS path was clean and the FAILURE path leaked.
 */
const SECRET_URL = 'https://eth-mainnet.g.alchemy.com/v2/SuperSecretApiKey123';
const SECRET2 = 'https://mainnet.infura.io/v3/anotherSecretKey';

describe('rpc-pool — endpoint URLs never reach a caller (arrakis-qf5kc)', () => {
  it('does not name the endpoint when every attempt fails', async () => {
    const pool = makeRpcPool({
      urls: [SECRET_URL, SECRET2],
      attemptsPerUrl: 1,
      sleep: async () => {},
      callOne: async (url) => {
        throw new Error(`boom: request to ${url} failed`);
      },
    });

    const err = await pool('eth_blockNumber', []).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).not.toContain('SuperSecretApiKey123');
    expect(msg).not.toContain('anotherSecretKey');
    expect(msg).not.toContain('alchemy');
    expect(msg).not.toContain('https://');
    // Still debuggable: the ordinal identifies WHICH endpoint without identifying it.
    expect(msg).toContain('endpoint 1 of 2');
    expect(msg).toContain('boom');
  });

  it('scrubs a URL that arrives from BELOW the pool (fetch/undici embed the request URL)', () => {
    expect(redactEndpoints(`request to ${SECRET_URL} failed, reason: ECONNREFUSED`)).toBe(
      'request to <endpoint> failed, reason: ECONNREFUSED',
    );
    // The whole URL, not just the query: paid providers put the key in the PATH.
    expect(redactEndpoints(SECRET_URL)).not.toContain('SuperSecretApiKey123');
  });

  it('scrubs schemeless provider hosts and credential paths from DNS/connect errors', () => {
    const message =
      'connect ECONNREFUSED eth-mainnet.g.alchemy.com:443/v2/SuperSecretApiKey123';
    expect(redactEndpoints(message)).toBe('connect ECONNREFUSED <endpoint>');
  });

  it('the refusal returned to the caller carries no endpoint URL (the actual leak path)', async () => {
    const C = '0x' + 'a'.repeat(40);
    const order: Order = {
      community: { name: 'thj', owner_wallet: '0x' + '9'.repeat(40) },
      source: { chain: '1', contract_address: C },
      gating_rule: { kind: 'nft-balance', threshold: 1 },
      products: ['audit'],
      mode: 'lead-magnet',
    };
    // Ownership blows up carrying the secret URL in its message — exactly what undici does.
    const leaky: OwnershipSource = {
      resolveSnapshotBlock: async () => {
        throw new Error(`RPC eth_getBlockByNumber failed — request to ${SECRET_URL} failed`);
      },
      balancesAt: async () => new Map(),
      currentBalances: async () => new Map(),
    };
    // A real snapshot, so the audit reaches OWNERSHIP RECONSTRUCTION (the leak path). Without it the
    // mode resolver refuses first and the test would pass vacuously.
    const roles: RoleSource = {
      load: async () => ({
        source: 'discord:guild:1',
        community: 'thj',
        collection: { chain: '1', contract: C },
        captured_at: '2026-06-30T00:00:00.000Z',
        export_method: 'export',
        owner: '0x' + '9'.repeat(40),
        freshness_threshold_seconds: 86_400_000,
        entries: Array.from({ length: 10 }, (_, i) => ({
          discord_user_id: `u${i}`,
          wallet: '0x' + (i + 1).toString(16).padStart(40, '0'),
          role_ids: ['h'],
        })),
      }),
    };
    const whale: WhaleSource = { concentration: async () => 0 };
    const sources: SourceResolver = () => [{ chain: '1', contract: C }];

    const r = await runAudit(
      {
        order,
        snapshotDate: '2026-06-01',
        isOperatedCommunity: true,
        nowUnixSeconds: Math.floor(Date.UTC(2026, 6, 1) / 1000),
        includeRecords: false,
        cta: { product: '/p', conversation: '/c' },
      },
      { ownership: leaky, whale, roles, sources },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The refusal is returned verbatim to an anonymous caller. It must disclose nothing.
    expect(r.refusal.reason).not.toContain('SuperSecretApiKey123');
    expect(r.refusal.reason).not.toContain('https://');
    expect(r.refusal.reason).toContain('<endpoint>');
  });
});
