/**
 * ShadowSubject — the reduced projection of a known community subject (SDD §3).
 *
 * A subject starts narrow (`discord_member` / `wallet_only` / `unresolved`) and
 * is promoted to `identity_user` ONLY by an identity-api verified link (FR-5).
 * `merge_provenance` records the triggering link so a future unlink can reverse
 * the merge (FR-12, flatline SKP-004).
 */

import type { WalletRef } from './common.js';

export type SubjectKind = 'identity_user' | 'discord_member' | 'wallet_only' | 'unresolved';

export type AttributionQuality = 'verified' | 'observed_only' | 'unresolved';

/** Provenance of a conservative merge (FR-12) — lets a revoke reverse it. */
export interface MergeProvenance {
  /** The identity.*.linked event_id that triggered the merge. */
  event_id: string;
  link_kind: 'wallet' | 'account';
  /** The verified identity user the alias was merged into. */
  identity_user_id: string;
}

export interface ShadowSubject {
  subject_id: string;
  community_id: string;
  kind: SubjectKind;
  identity_user_id?: string;
  discord_user_id?: string;
  display_name?: string;
  wallets: WalletRef[];
  aliases: string[];
  current_roles: string[];
  incumbent_roles: string[];
  freeside_roles: string[];
  attribution_quality: AttributionQuality;
  last_seen_at: string;
  /** Present once a verified link merged an alias into this identity_user. */
  merge_provenance?: MergeProvenance[];
  /** Set true when a revoke downgraded this subject; flags it for re-split (fast-follow). */
  pending_resplit?: boolean;
}
