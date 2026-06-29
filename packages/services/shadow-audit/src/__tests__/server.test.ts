/**
 * Sprint 2 / S2-T4 — the deployment composition root, exercised with INJECTED fakes (no live network,
 * the #306 discipline). Covers: the local adapters (whale concentration, file role-source), the
 * X-API-Key gate, /healthz, fail-loud env config, and the GET aggregate happy-path end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAuditApp, configFromEnv, type AuditServerConfig } from '../server.js';
import { makeBalanceWhaleSource } from '../whale-source.js';
import { makeFileRoleSource } from '../role-source.js';
import type { OwnershipSource, Balances } from '../audit-service.js';

const R1 = '0x' + '1'.repeat(40);
const R2 = '0x' + '2'.repeat(40);
const Y = '0x' + '5'.repeat(40);
const CTA = { product: 'https://product', conversation: 'https://talk' };

/** A fake OwnershipSource — the injection seam that keeps the suite hermetic. */
const fakeOwnership = (snap: Balances, cur: Balances): OwnershipSource => ({
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => snap,
  currentBalances: async () => cur,
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
    chain: '80094',
    contract: '0x' + 'a'.repeat(40),
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
    expect(await makeFileRoleSource(undefined).load()).toBeUndefined();
  });
  it('loads + validates a real snapshot', async () => {
    const { path, cleanup } = tempRoleSnapshot('thj', R1);
    try {
      const snap = await makeFileRoleSource(path).load();
      expect(snap?.community).toBe('thj');
      expect(snap?.entries[0]?.wallet).toBe(R1);
    } finally {
      cleanup();
    }
  });
  it('THROWS on a missing file (fail loud, never silent-undefined)', async () => {
    await expect(makeFileRoleSource('/no/such/roles.json').load()).rejects.toThrow();
  });
  it('THROWS on an invalid snapshot shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-bad-'));
    const path = join(dir, 'roles.json');
    writeFileSync(path, JSON.stringify({ not: 'a snapshot' }));
    try {
      await expect(makeFileRoleSource(path).load()).rejects.toThrow();
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
      const app = buildAuditApp(ownership, baseConfig({ roleSnapshotPath: path }));
      const res = await app.request(`/v1/audit?${query('thj')}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { aggregate?: unknown; cta?: unknown; run_id?: string };
      expect(body.run_id).toBeTruthy();
      expect(body.aggregate).toBeTruthy();
      expect(body.cta).toEqual(CTA);
    } finally {
      cleanup();
    }
  });

  it('refuses an un-operated community (external-mode), never a wrong audit', async () => {
    const app = buildAuditApp(ownership, baseConfig());
    const res = await app.request(`/v1/audit?${query('not-ours')}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('/healthz is open (no key required)', async () => {
    const app = buildAuditApp(ownership, baseConfig({ apiKey: 'secret' }));
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('X-API-Key gate: a missing/wrong key → 401', async () => {
    const app = buildAuditApp(ownership, baseConfig({ apiKey: 'secret' }));
    expect((await app.request(`/v1/audit?${query('thj')}`)).status).toBe(401);
    expect(
      (await app.request(`/v1/audit?${query('thj')}`, { headers: { 'x-api-key': 'wrong' } })).status,
    ).toBe(401);
  });

  it('the authed POST named-output is fail-closed (V2 not wired) → 401', async () => {
    const app = buildAuditApp(ownership, baseConfig());
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
