/**
 * Sprint 2 / S2-T4 — the deployment composition root, exercised with INJECTED fakes (no live network,
 * the #306 discipline). Covers: the local adapters (whale concentration, file role-source), the
 * X-API-Key gate, /healthz, fail-loud env config, and the GET aggregate happy-path end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditOutputSchema } from '@freeside/shadow-audit-protocol';
import { buildAuditApp, configFromEnv, validateApiKeyEnv, type AuditServerConfig } from '../server.js';
import { makeBalanceWhaleSource } from '../whale-source.js';
import { makeFileRoleSource } from '../role-source.js';
import type { OwnershipSource, Balances } from '../audit-service.js';
import { buildCollectionIndex } from '../ownership-source.js';

const R1 = '0x' + '1'.repeat(40);
const R2 = '0x' + '2'.repeat(40);
const Y = '0x' + '5'.repeat(40);
const CTA = { product: 'https://product', conversation: 'https://talk' };
// The collection every fixture here is gated on — the same one `query()` audits (S5-T1: a role source
// serves a snapshot only for the collection asked for).
const CHAIN = '80094';
const CONTRACT = '0x' + 'a'.repeat(40);
const COLLECTION_KEY = `${CHAIN}/${CONTRACT}`;

/** A fake OwnershipSource — the injection seam that keeps the suite hermetic. */
const fakeOwnership = (snap: Balances, cur: Balances): OwnershipSource => ({
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => snap,
  currentBalances: async () => cur,
});

/** S5-T3: the app needs the collection INDEX — the membership lookup AND the deployment set the audit
 *  unions. Without it the app is fail-closed (see the `no registry` test below). */
const collections = buildCollectionIndex({
  [COLLECTION_KEY]: { collection: 'honeycomb', standard: 'erc721' },
});

/** Write a valid RoleSnapshot to a temp file and return its path + a cleanup fn. */
function tempRoleSnapshot(community: string, roleWallet: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'audit-roles-'));
  const path = join(dir, 'roles.json');
  writeFileSync(
    path,
    JSON.stringify({
      source: 'discord',
      community,
      collection: { chain: CHAIN, contract: CONTRACT },
      captured_at: new Date(Date.now() - 60_000).toISOString(),
      export_method: 'test-fixture',
      owner: 'op',
      freshness_threshold_seconds: 86_400,
      entries: [{ discord_user_id: 'u1', wallet: roleWallet, role_ids: ['role-a'] }],
    }),
  );
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function query(community: string): string {
  return new URLSearchParams({
    chain: CHAIN,
    contract: CONTRACT,
    snapshot_date: '2026-06-01',
    community,
    owner_wallet: '0x' + 'b'.repeat(40),
    threshold: '1',
  }).toString();
}

// ── local adapters ──

describe('makeBalanceWhaleSource — top-holder concentration over the distribution', () => {
  const whale = makeBalanceWhaleSource();
  it('is the largest holder share of the total', async () => {
    expect(await whale.concentration(new Map([[R1, 3n], [R2, 1n]]))).toBeCloseTo(0.75);
  });
  it('is 0 for an empty set (no divide-by-zero)', async () => {
    expect(await whale.concentration(new Map())).toBe(0);
  });
  it('ignores zero/negative entries', async () => {
    expect(await whale.concentration(new Map([[R1, 2n], [R2, 0n]]))).toBe(1);
  });
});

describe('makeFileRoleSource — validated file loader', () => {
  it('returns undefined when no path is configured', async () => {
    expect(await makeFileRoleSource(undefined).load(COLLECTION_KEY)).toBeUndefined();
  });
  it('loads + validates a real snapshot', async () => {
    const { path, cleanup } = tempRoleSnapshot('thj', R1);
    try {
      const snap = await makeFileRoleSource(path).load(COLLECTION_KEY);
      expect(snap?.community).toBe('thj');
      expect(snap?.entries[0]?.wallet).toBe(R1);
    } finally {
      cleanup();
    }
  });
  it('serves the file only for ITS collection (S5-T1 — never another gate’s role-holders)', async () => {
    const { path, cleanup } = tempRoleSnapshot('thj', R1);
    try {
      const other = `${CHAIN}/0x${'b'.repeat(40)}`;
      expect(await makeFileRoleSource(path).load(other)).toBeUndefined();
    } finally {
      cleanup();
    }
  });
  it('THROWS on a missing file (fail loud, never silent-undefined)', async () => {
    await expect(makeFileRoleSource('/no/such/roles.json').load(COLLECTION_KEY)).rejects.toThrow();
  });
  it('THROWS on an invalid snapshot shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-bad-'));
    const path = join(dir, 'roles.json');
    writeFileSync(path, JSON.stringify({ not: 'a snapshot' }));
    try {
      await expect(makeFileRoleSource(path).load(COLLECTION_KEY)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── the composition root ──

const baseConfig = (over: Partial<AuditServerConfig> = {}): AuditServerConfig => ({
  operatedCommunities: ['thj'],
  cta: CTA,
  ...over,
});

describe('buildAuditApp — the deployment composition root', () => {
  const ownership = fakeOwnership(new Map([[R1, 1n], [R2, 1n]]), new Map([[Y, 1n]])); // R1,R2 sold → R1 stale; Y new

  it('GET /v1/audit serves the k-anon aggregate for an operated community', async () => {
    const { path, cleanup } = tempRoleSnapshot('thj', R1);
    try {
      const app = buildAuditApp(ownership, baseConfig({ roleSnapshotPath: path }), collections);
      const res = await app.request(`/v1/audit?${query('thj')}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      // CONTRACT PARITY (the integration's load-bearing assertion): the GET response must STRICT-parse
      // against the protocol AuditOutputSchema — that is exactly what freeside-dashboard's client does
      // (onExcessProperty: error). An earlier subset + excess `uncertain` made the dashboard reject every
      // 200 and show empty. This pins the seam so the drift can never silently return.
      expect(() => AuditOutputSchema.parse(body)).not.toThrow();
      const parsed = AuditOutputSchema.parse(body);
      expect(parsed.run_id).toBeTruthy();
      expect(parsed.mode).toBe('dogfood-full');
      expect(parsed.inputs_hash).toBeTruthy();
      expect(parsed.cta).toEqual(CTA);
    } finally {
      cleanup();
    }
  });

  it('FAIL-CLOSED (S5-T3): with NO collection index, every audit refuses — never a single-source guess', async () => {
    // An app that cannot enumerate a collection's deployments cannot know whether it is auditing one chain
    // of several. Guessing "it stands alone" is precisely the bug that branded every ethereum Honeycomb
    // holder stale. So a mis-wired composition root refuses loudly instead of serving a plausible number.
    const { path, cleanup } = tempRoleSnapshot('thj', R1);
    try {
      const app = buildAuditApp(ownership, baseConfig({ roleSnapshotPath: path })); // no index
      const res = await app.request(`/v1/audit?${query('thj')}`);
      expect(res.status).toBe(404);
      expect((await res.json() as { error: { code: string } }).error.code).toBe('unindexed-contract');
    } finally {
      cleanup();
    }
  });

  it('refuses an un-operated community (external-mode), never a wrong audit', async () => {
    const app = buildAuditApp(ownership, baseConfig(), collections);
    const res = await app.request(`/v1/audit?${query('not-ours')}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('/healthz is open (no key required)', async () => {
    const app = buildAuditApp(ownership, baseConfig({ apiKey: 'secret' }), collections);
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('X-API-Key gate: a missing/wrong key → 401', async () => {
    const app = buildAuditApp(ownership, baseConfig({ apiKey: 'secret' }), collections);
    expect((await app.request(`/v1/audit?${query('thj')}`)).status).toBe(401);
    expect(
      (await app.request(`/v1/audit?${query('thj')}`, { headers: { 'x-api-key': 'wrong' } })).status,
    ).toBe(401);
  });

  it('the authed POST named-output is fail-closed (V2 not wired) → 401', async () => {
    const app = buildAuditApp(ownership, baseConfig(), collections);
    const res = await app.request('/v1/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chain: '80094',
        contract: '0x' + 'a'.repeat(40),
        snapshot_date: '2026-06-01',
        community: 'thj',
        owner_wallet: '0x' + 'b'.repeat(40),
        auth: { message: {}, signature: '0x', ownerWallet: '0x' + 'b'.repeat(40) },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400); // never half-serves named records
  });
});

describe('configFromEnv — fail loud on missing required config', () => {
  it('throws without OPERATED_COMMUNITIES', () => {
    expect(() => configFromEnv({ CTA_PRODUCT: 'p', CTA_CONVERSATION: 'c' } as NodeJS.ProcessEnv)).toThrow(/OPERATED_COMMUNITIES/);
  });
  it('throws without the CTA doors', () => {
    expect(() => configFromEnv({ OPERATED_COMMUNITIES: 'thj' } as NodeJS.ProcessEnv)).toThrow(/CTA_/);
  });
  it('throws on AUDIT_K < 1 (k-anonymity disabled is a privacy regression — FAGAN MEDIUM-5)', () => {
    const base = { OPERATED_COMMUNITIES: 'thj', CTA_PRODUCT: 'p', CTA_CONVERSATION: 'c' };
    expect(() => configFromEnv({ ...base, AUDIT_K: '0' } as NodeJS.ProcessEnv)).toThrow(/AUDIT_K/);
    expect(() => configFromEnv({ ...base, AUDIT_K: 'abc' } as NodeJS.ProcessEnv)).toThrow(/AUDIT_K/);
    expect(() => configFromEnv({ ...base, AUDIT_K: '-3' } as NodeJS.ProcessEnv)).toThrow(/AUDIT_K/);
    expect(configFromEnv({ ...base, AUDIT_K: '5' } as NodeJS.ProcessEnv).k).toBe(5);
  });

  it('requires a database URL for the postgres snapshot store', () => {
    const base = {
      OPERATED_COMMUNITIES: 'thj',
      CTA_PRODUCT: 'p',
      CTA_CONVERSATION: 'c',
      ROLE_SNAPSHOT_STORE: 'postgres',
      ROLE_SNAPSHOT_INGEST_TOKEN: 'ingest-secret',
    };
    expect(() => configFromEnv(base as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(
      configFromEnv({ ...base, DATABASE_URL: 'postgres://db/shadow' } as NodeJS.ProcessEnv),
    ).toMatchObject({ roleSnapshotStore: 'postgres', databaseUrl: 'postgres://db/shadow' });
  });

  it('requires ingestion to be enabled when the postgres snapshot store is selected', () => {
    expect(() =>
      configFromEnv({
        OPERATED_COMMUNITIES: 'thj',
        CTA_PRODUCT: 'p',
        CTA_CONVERSATION: 'c',
        ROLE_SNAPSHOT_STORE: 'postgres',
        DATABASE_URL: 'postgres://db/shadow',
      } as NodeJS.ProcessEnv),
    ).toThrow(/ROLE_SNAPSHOT_INGEST_TOKEN/);
  });

  it('rejects an unknown snapshot-store backend', () => {
    expect(() =>
      configFromEnv({
        OPERATED_COMMUNITIES: 'thj',
        CTA_PRODUCT: 'p',
        CTA_CONVERSATION: 'c',
        ROLE_SNAPSHOT_STORE: 'redis',
      } as NodeJS.ProcessEnv),
    ).toThrow(/ROLE_SNAPSHOT_STORE/);
  });

  it('builds a valid config from a complete env', () => {
    const cfg = configFromEnv({
      OPERATED_COMMUNITIES: 'thj, other',
      CTA_PRODUCT: 'https://p',
      CTA_CONVERSATION: 'https://c',
      SHADOW_AUDIT_API_KEY: 'k',
    } as NodeJS.ProcessEnv);
    expect(cfg.operatedCommunities).toEqual(['thj', 'other']);
    expect(cfg.cta).toEqual({ product: 'https://p', conversation: 'https://c' });
    expect(cfg.apiKey).toBe('k');
  });
});

describe('buildAuditApp — postgres role-store composition', () => {
  const ownership = fakeOwnership(new Map([[R1, 1n]]), new Map([[R1, 1n]]));

  it('fails startup when ingestion is enabled without a collection index', () => {
    expect(() =>
      buildAuditApp(
        ownership,
        baseConfig({ ingestToken: 'ingest-secret' }),
      ),
    ).toThrow(/COLLECTION_REGISTRY is unavailable/);
  });

  it('fails startup when postgres is selected but no initialized store is injected', () => {
    expect(() =>
      buildAuditApp(
        ownership,
        baseConfig({ ingestToken: 'ingest-secret', roleSnapshotStore: 'postgres' }),
        collections,
      ),
    ).toThrow(/initialized Postgres role store/);
  });

  it('fails startup when postgres is selected but the shared teaser budget is absent', () => {
    const roleStore = {
      load: async () => undefined,
      store: async () => true,
    };
    expect(() =>
      buildAuditApp(
        ownership,
        baseConfig({ ingestToken: 'ingest-secret', roleSnapshotStore: 'postgres' }),
        collections,
        { roleStore },
      ),
    ).toThrow(/deployment-shared Postgres teaser budget/);
  });

  it('fails startup rather than serving one community from another community\'s role store', () => {
    expect(() =>
      buildAuditApp(
        ownership,
        baseConfig({ operatedCommunities: ['thj', 'other'], ingestToken: 'ingest-secret' }),
        collections,
      ),
    ).toThrow(/exactly one OPERATED_COMMUNITIES/);
  });
});

describe('capability read security boundary (FR-2 / PRD §Security boundary)', () => {
  const ownership = fakeOwnership(new Map([[R1, 1n]]), new Map([[R1, 1n]]));

  it('GET /v1/collections is OPEN even when an X-API-Key is configured', async () => {
    const app = buildAuditApp(ownership, baseConfig({ apiKey: 'secret' }), buildCollectionIndex({ '1/0xabc': { collection: 'azuki', standard: 'erc721' } }));
    // no key header → still 200 (capability read carries no member data)
    const res = await app.request('/v1/collections/1/0xABC');
    expect(res.status).toBe(200);
    // and /v1/audit WITHOUT the key is still gated
    const gated = await app.request(`/v1/audit?${query('thj')}`);
    expect(gated.status).toBe(401);
  });
});

// ── §12.3 startup key guard ──

describe('validateApiKeyEnv — §12.3 fail-closed startup guard', () => {
  it('startup-refusal: throws when SHADOW_AUDIT_API_KEY is absent', () => {
    expect(() => validateApiKeyEnv({} as NodeJS.ProcessEnv)).toThrow(/SHADOW_AUDIT_API_KEY/);
  });

  it('startup-refusal: throws when SHADOW_AUDIT_API_KEY is empty string', () => {
    expect(() => validateApiKeyEnv({ SHADOW_AUDIT_API_KEY: '' } as NodeJS.ProcessEnv)).toThrow(/SHADOW_AUDIT_API_KEY/);
  });

  it('startup-refusal: rejects a wrong SHADOW_AUDIT_ALLOW_ANON value (not dev-only)', () => {
    expect(() => validateApiKeyEnv({ SHADOW_AUDIT_ALLOW_ANON: 'true' } as NodeJS.ProcessEnv)).toThrow(/SHADOW_AUDIT_API_KEY/);
    expect(() => validateApiKeyEnv({ SHADOW_AUDIT_ALLOW_ANON: '1' } as NodeJS.ProcessEnv)).toThrow(/SHADOW_AUDIT_API_KEY/);
  });

  it('dev escape: allows startup when SHADOW_AUDIT_ALLOW_ANON=dev-only (local dev, never production)', () => {
    expect(() => validateApiKeyEnv({ SHADOW_AUDIT_ALLOW_ANON: 'dev-only' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('allows startup when SHADOW_AUDIT_API_KEY is set', () => {
    expect(() => validateApiKeyEnv({ SHADOW_AUDIT_API_KEY: 'some-secret' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

// ── §12.3 correct-key → 200 ──

describe('buildAuditApp — §12.3 correct key returns 200', () => {
  const ownership = fakeOwnership(new Map([[R1, 1n], [R2, 1n]]), new Map([[Y, 1n]]));

  it('200 on correct X-API-Key (§12.3)', async () => {
    const { path, cleanup } = tempRoleSnapshot('thj', R1);
    try {
      const app = buildAuditApp(ownership, baseConfig({ apiKey: 'correct-key', roleSnapshotPath: path }), collections);
      const res = await app.request(`/v1/audit?${query('thj')}`, {
        headers: { 'x-api-key': 'correct-key' },
      });
      expect(res.status).toBe(200);
    } finally {
      cleanup();
    }
  });

  it('401 on missing key (§12.3)', async () => {
    const app = buildAuditApp(ownership, baseConfig({ apiKey: 'correct-key' }), collections);
    expect((await app.request(`/v1/audit?${query('thj')}`)).status).toBe(401);
  });

  it('401 on wrong key (§12.3)', async () => {
    const app = buildAuditApp(ownership, baseConfig({ apiKey: 'correct-key' }), collections);
    expect(
      (await app.request(`/v1/audit?${query('thj')}`, { headers: { 'x-api-key': 'wrong-key' } })).status,
    ).toBe(401);
  });
});
