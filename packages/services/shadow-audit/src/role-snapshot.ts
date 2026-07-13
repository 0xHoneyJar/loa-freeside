/**
 * SDD §2 + §11 (IMP-005) — RoleSnapshot.
 *
 * A dogfood community's Discord role export. The wallet↔role identity mapping
 * is explicit: a role-holder with no resolvable wallet is FLAGGED (surfaced),
 * never silently dropped. Staleness is represented, not hidden — a snapshot
 * older than its freshness threshold drives an uncertainty label downstream.
 *
 * S5-T1 — a snapshot names the COLLECTION its gate is for. A community gates SEVERAL collections
 * (thj gates Honeycomb + HoneyJar1-6, each behind its own Discord role), and the exporter exports ONE
 * gated role-set at a time. Without the collection on the wire, the audit can only key role data by
 * community — so ingesting the HoneyJar1 export would overwrite the Honeycomb one and the Honeycomb
 * audit would then compute stale-access against HoneyJar1's role-holders: a confidently-wrong audit,
 * the exact failure class this service exists to prevent.
 */

import { z } from 'zod';

export const RoleSnapshotEntrySchema = z
  .object({
    discord_user_id: z.string().min(1),
    /** Resolved on-chain wallet; absent when identity could not be resolved. */
    wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
    role_ids: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type RoleSnapshotEntry = z.infer<typeof RoleSnapshotEntrySchema>;

/**
 * The collection whose gate this snapshot exports. (chain, contract) — deliberately the SAME identity
 * the audit's `Order.source` names, so NO translation table sits between the exporter and the audit
 * (a second namespace — e.g. a belt-gateway collection id — would have to be mapped, and a mapping is
 * a place for the two sides to disagree silently).
 */
export const SnapshotCollectionSchema = z
  .object({
    /** Chain slug or numeric chain id, as the Order names it (protocol ChainSchema: `^[a-z0-9-]+$`). */
    chain: z.string().min(1),
    contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .strict();
export type SnapshotCollection = z.infer<typeof SnapshotCollectionSchema>;

/**
 * The canonical collection identity — the ONE string the exporter, the store and the audit must agree
 * on. Lowercased, `<chain>/<contract>`: the same key shape the collection registry uses
 * (`registryFromMap`), so an address's checksum casing can never split one collection into two keys.
 */
export function collectionKey(c: SnapshotCollection): string {
  return `${c.chain}/${c.contract}`.toLowerCase();
}

export const RoleSnapshotSchema = z
  .object({
    source: z.string().min(1),
    community: z.string().min(1),
    /** The gated collection this export is FOR. REQUIRED: without it the snapshot cannot be keyed, and
     *  an unkeyed snapshot is one that silently overwrites a sibling collection's. */
    collection: SnapshotCollectionSchema,
    /** ISO-8601 UTC instant the export was captured. */
    captured_at: z.string().datetime(),
    export_method: z.string().min(1),
    owner: z.string().min(1),
    freshness_threshold_seconds: z.number().int().positive(),
    entries: z.array(RoleSnapshotEntrySchema),
  })
  .strict();
export type RoleSnapshot = z.infer<typeof RoleSnapshotSchema>;

/** True iff the snapshot is within its freshness threshold of `nowUnixSeconds`. */
export function isSnapshotFresh(snap: RoleSnapshot, nowUnixSeconds: number): boolean {
  const capturedUnix = Math.floor(Date.parse(snap.captured_at) / 1000);
  return nowUnixSeconds - capturedUnix <= snap.freshness_threshold_seconds;
}

export interface RoleResolution {
  /** Lowercased wallets that hold at least one role. */
  roleWallets: Set<string>;
  /** Role-holders whose wallet could not be resolved — flagged, not dropped. */
  unmatched: Array<{ discord_user_id: string; role_ids: string[] }>;
}

/** Resolve a snapshot into a wallet set + the explicitly-flagged unmatched set. */
export function resolveRoles(snap: RoleSnapshot): RoleResolution {
  const roleWallets = new Set<string>();
  const unmatched: RoleResolution['unmatched'] = [];
  for (const e of snap.entries) {
    if (e.wallet) {
      roleWallets.add(e.wallet.toLowerCase());
    } else {
      unmatched.push({ discord_user_id: e.discord_user_id, role_ids: e.role_ids });
    }
  }
  return { roleWallets, unmatched };
}
