import { describe, it, expect } from 'vitest';
import type { SourceResolver } from '../collection-union.js';
import { type Order } from '@freeside/shadow-audit-protocol';
import { runAudit, type AuditRequest, type OwnershipSource, type RoleSource, type WhaleSource } from '../audit-service.js';
import type { RoleSnapshot } from '../role-snapshot.js';
import { comparisonArtifact, exportComparisonJson, exportComparisonCsv, ComparisonUnavailableError } from '../comparison-export.js';

/**
 * T3 GATE (custody) — `arrakis-wedge-migration-delta-cbox.2`. The export is the viral artifact; it must be a
 * VERIFIABLE record, not a screenshot: it round-trips, it carries its own provenance (run_id + inputs_hash +
 * methodology), and it FAILS CLOSED on an anon audit (no per-member delta to export). This is also the real
 * consumer that makes the keystone load-bearing — something now reads output.comparison.
 */

const A = (tag: string, i: number): string => '0x' + `${tag}${i}`.padStart(40, '0');
const CONTRACT = '0x' + 'a'.repeat(40);
const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);

const roleStale = [1, 2, 3].map((i) => A('a', i)); // demotions
const roleOk = [1, 2].map((i) => A('b', i)); //       no_change
const newlyElig = [1, 2].map((i) => A('c', i)); //    promotions

const ownership: OwnershipSource = {
  resolveSnapshotBlock: async () => 18_000_000,
  balancesAt: async () => new Map([...roleOk, ...newlyElig].map((w) => [w, 1n] as const)),
  currentBalances: async () => new Map([...roleOk, ...newlyElig].map((w) => [w, 1n] as const)),
};
// S5-T3: this suite audits a collection with ONE declared deployment (a union of one) — its intent is
// unchanged. The multi-source cases live in audit-service.test.ts / access-risk.test.ts.
const sources: SourceResolver = () => [{ chain: "1", contract: CONTRACT }];
const whale: WhaleSource = { concentration: async () => 0.3 };
const mkRoles = (community: string): RoleSource => ({
  load: async (): Promise<RoleSnapshot> => ({
    source: 'discord:guild:1', community, collection: { chain: '1', contract: CONTRACT },
    captured_at: '2026-06-22T11:00:00.000Z', export_method: 'export',
    owner: A('9', 9), freshness_threshold_seconds: 86_400,
    entries: [...roleStale, ...roleOk].map((wallet, i) => ({ discord_user_id: `u${i}`, wallet, role_ids: ['h'] })),
  }),
});
const mkOrder = (community: string): Order => ({
  community: { name: community, owner_wallet: A('9', 9) },
  source: { chain: '1', contract_address: CONTRACT },
  gating_rule: { kind: 'nft-balance', threshold: 1 },
  products: ['audit'], mode: 'lead-magnet',
});
const mkReq = (community: string, includeRecords: boolean): AuditRequest => ({
  order: mkOrder(community), snapshotDate: '2026-06-22', isOperatedCommunity: true, nowUnixSeconds: NOW,
  includeRecords, cta: { product: '/shadow-access', conversation: '/talk' },
});

const authedOutput = async (community = 'thj') => {
  const r = await runAudit(mkReq(community, true), { ownership, whale, roles: mkRoles(community), sources });
  if (!r.ok) throw new Error('audit refused');
  return r.output;
};

describe('comparison-export — the shareable, provenance-bearing migration-delta artifact (T3)', () => {
  it('CUSTODY: the JSON export round-trips (parse(serialize(x)) deep-equals the artifact)', async () => {
    const output = await authedOutput();
    const json = exportComparisonJson(output);
    expect(JSON.parse(json)).toEqual(comparisonArtifact(output));
  });

  it('CUSTODY: the artifact carries its own provenance — run_id, inputs_hash, methodology', async () => {
    const output = await authedOutput();
    const a = comparisonArtifact(output);
    expect(a.run_id).toBe(output.run_id);
    expect(a.inputs_hash).toBe(output.inputs_hash);
    expect(a.methodology).toEqual({
      rule_id: 'nft-balance:1',
      role_snapshot_at: '2026-06-22T11:00:00.000Z',
      evidence_block: 18_000_000,
      sources: ['sonar', 'role-snapshot'],
      // S5-T3: the artifact also carries the union semantics + the exact deployments it was computed over.
      union_semantics: 'any-source',
      collection_sources: [{ chain: '1', contract: CONTRACT, snapshot_block: 18_000_000 }],
    });
    expect(a.delta).toEqual(output.comparison!.aggregate);
    expect(a.delta.demotions).toBe(3);
    expect(a.delta.promotions).toBe(2);
  });

  it('CSV carries the provenance preamble + the per-member table', async () => {
    const csv = exportComparisonCsv(await authedOutput());
    expect(csv).toContain('# rule=nft-balance:1 role_snapshot_at=2026-06-22T11:00:00.000Z evidence_block=18000000');
    expect(csv).toMatch(/# promotions=2 demotions=3 no_change=2 total=7/);
    expect(csv).toContain('wallet,community,holds_role,qualifies,band,change');
    const dataRows = csv.trimEnd().split('\n').filter((l) => !l.startsWith('#') && !l.startsWith('wallet,'));
    expect(dataRows).toHaveLength(7); // 3 stale + 2 ok + 2 missing
    expect(dataRows.some((l) => l.includes(',stale,demotion'))).toBe(true);
    expect(dataRows.some((l) => l.includes(',missing,promotion'))).toBe(true);
  });

  it('CSV escapes a field carrying a comma (RFC-4180 quoting — the artifact stays parseable)', async () => {
    const csv = exportComparisonCsv(await authedOutput('thj, the hive'));
    expect(csv).toContain('"thj, the hive"'); // the community field is quoted, not column-split
  });

  it('MEDIUM-1: neutralizes CSV formula-injection in the attacker-controlled community field', async () => {
    const csv = exportComparisonCsv(await authedOutput('=1+1'));
    expect(csv).toContain(",'=1+1,"); // prefixed with ' → a spreadsheet treats it as text, not a formula
    expect(csv).not.toMatch(/,=1\+1,/); // never a raw =formula at a field boundary
  });

  it('FAIL-CLOSED: exporting an ANON audit (no comparison) throws — no fabricated per-member delta', async () => {
    const r = await runAudit(mkReq('thj', false), { ownership, whale, roles: mkRoles('thj'), sources });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.comparison).toBeUndefined();
    expect(() => exportComparisonJson(r.output)).toThrow(ComparisonUnavailableError);
    expect(() => exportComparisonCsv(r.output)).toThrow(ComparisonUnavailableError);
  });
});
