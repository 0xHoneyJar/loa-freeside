/**
 * S1-T6 (IMP-008) — cross-repo `/v1/role-snapshot` contract pin.
 *
 * The exporter (freeside-characters, S3) PRODUCES a RoleSnapshot; this service CONSUMES it. Prose in two
 * repos drifts silently. This pins the wire shape against a golden fixture + the SAME exported schema the
 * exporter imports (`@freeside/shadow-audit-service` → `RoleSnapshotSchema`), so a field
 * add/remove/rename breaks a test instead of a live ingest. The exporter side runs the mirror of this in
 * freeside-characters CI against the same fixture (S3-T4).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RoleSnapshotSchema,
  RoleSnapshotEntrySchema,
  collectionKey,
  type RoleSnapshot,
} from '../role-snapshot.js';

const golden = JSON.parse(
  readFileSync(new URL('./fixtures/role-snapshot.golden.json', import.meta.url), 'utf8'),
) as unknown;

describe('/v1/role-snapshot cross-repo contract (S1-T6)', () => {
  it('the canonical fixture parses against the exported RoleSnapshotSchema', () => {
    const parsed: RoleSnapshot = RoleSnapshotSchema.parse(golden);
    expect(parsed.community).toBe('thj');
    expect(parsed.entries.length).toBe(2);
  });

  it('pins the EXACT top-level wire keys — an add/remove breaks the exporter contract', () => {
    expect(Object.keys(golden as object).sort()).toEqual(
      ['captured_at', 'collection', 'community', 'entries', 'export_method', 'freshness_threshold_seconds', 'owner', 'source'].sort(),
    );
  });

  it('pins the COLLECTION the snapshot is for (S5-T1) — required, (chain, contract), strict', () => {
    // A community gates several collections; a snapshot that does not name ITS collection cannot be keyed,
    // and an unkeyed snapshot silently overwrites a sibling gate's role-holders.
    const parsed = RoleSnapshotSchema.parse(golden);
    expect(Object.keys(parsed.collection).sort()).toEqual(['chain', 'contract']);
    expect(collectionKey(parsed.collection)).toBe('80094/0x886d2176d899796cd1affa07eff07b9b2b80f1be');

    const { collection: _omitted, ...withoutCollection } = golden as Record<string, unknown>;
    expect(() => RoleSnapshotSchema.parse(withoutCollection)).toThrow(); // REQUIRED
    expect(() =>
      RoleSnapshotSchema.parse({ ...(golden as object), collection: { chain: '1', contract: 'not-an-address' } }),
    ).toThrow();
  });

  it('pins entry shape: wallet is OPTIONAL (an unmatched role-holder is FLAGGED, never dropped)', () => {
    const entries = (golden as { entries: unknown[] }).entries;
    const matched = entries.map((e) => RoleSnapshotEntrySchema.parse(e)).find((e) => e.wallet);
    const unmatched = entries.map((e) => RoleSnapshotEntrySchema.parse(e)).find((e) => !e.wallet);
    expect(matched?.wallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // The fixture MUST carry an unmatched entry — that is the contract the exporter must honor.
    expect(unmatched).toBeDefined();
  });

  it('the schema is CLOSED — an extra top-level field is rejected (strict wire shape)', () => {
    expect(() => RoleSnapshotSchema.parse({ ...(golden as object), unexpected: 'nope' })).toThrow();
  });

  it('a bad wallet in an entry is rejected (identity fields are shape-checked)', () => {
    const bad = { discord_user_id: 'x', wallet: '0xnothex', role_ids: ['h'] };
    expect(() => RoleSnapshotEntrySchema.parse(bad)).toThrow();
  });
});
