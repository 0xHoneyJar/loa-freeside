/**
 * SDD §2 + §11 (IMP-005) — RoleSnapshot.
 *
 * A dogfood community's Discord role export. The wallet↔role identity mapping
 * is explicit: a role-holder with no resolvable wallet is FLAGGED (surfaced),
 * never silently dropped. Staleness is represented, not hidden — a snapshot
 * older than its freshness threshold drives an uncertainty label downstream.
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

export const RoleSnapshotSchema = z
  .object({
    source: z.string().min(1),
    community: z.string().min(1),
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
