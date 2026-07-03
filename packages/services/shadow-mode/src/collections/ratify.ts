/**
 * ratify — the operator's one gesture (SDD collections-sot §4, FAGAN HIGH-1).
 *
 * A label flips `ai-derived → operator-validated` ONLY via a fresh cockpit grant
 * (the /recall force-chain: `~/.claude/.recall-cockpit-grant`, 900s TTL,
 * single-consume — matching `memory-promotion-guard.sh`). The agent has NO code
 * path that appends a `collection.label.ratified` observation without consuming
 * a grant. DERIVED labels are rejected upstream by `collectionLabelRatified`
 * (ground truth is never ratified); a member subject_id (not `chain:contract`)
 * also can't be collection-ratified (identity guard).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { statSync, rmSync } from 'node:fs';
import { collectionLabelRatified, type CollectionLabelName } from '@freeside/shadow-mode-protocol';
import type { ILedgerStore } from '../ports/ledger-store.js';
import type { AppendGrant } from '../auth/append-grant.js';

export const COCKPIT_GRANT_TTL_MS = 900_000; // 15 min, matches memory-promotion-guard.sh

export interface CockpitGrantOpts {
  /** Override for tests; defaults to ~/.claude/.recall-cockpit-grant. */
  grantPath?: string;
  /** Override the clock for tests (ms). */
  nowMs?: number;
  ttlMs?: number;
}

function defaultGrantPath(): string {
  return join(homedir(), '.claude', '.recall-cockpit-grant');
}

/**
 * Consume a fresh cockpit grant: true iff the grant file exists AND is younger
 * than the TTL. ALWAYS unlinks it on a valid consume (one gesture = one write).
 * A stale grant is also unlinked (it can never authorize) and returns false.
 */
export function consumeCockpitGrant(opts: CockpitGrantOpts = {}): boolean {
  const path = opts.grantPath ?? defaultGrantPath();
  const ttl = opts.ttlMs ?? COCKPIT_GRANT_TTL_MS;
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return false; // no grant
  }
  const now = opts.nowMs ?? Date.now();
  const fresh = now - mtimeMs <= ttl;
  // one gesture = one write: consume the grant whether fresh or stale
  try {
    rmSync(path, { force: true });
  } catch {
    /* best-effort unlink */
  }
  return fresh;
}

export interface RatifyResult {
  ok: boolean;
  entity_id: string;
  reason?: 'no_grant' | 'rejected_label' | 'append_failed';
}

/**
 * Ratify one SUBJECTIVE label. Requires a fresh cockpit grant (consumed here).
 * Returns `rejected_label` if the label is DERIVED or the identity/value is
 * malformed (`collectionLabelRatified` returned null) — fail loud, never a
 * silent attested no-op.
 */
export async function ratifyCollectionLabel(
  store: ILedgerStore,
  grant: AppendGrant,
  args: { entity_id: string; label: CollectionLabelName; value: string; ratified_by: string },
  nowIso: string,
  cockpit: CockpitGrantOpts = {},
): Promise<RatifyResult> {
  if (!consumeCockpitGrant(cockpit)) {
    return { ok: false, entity_id: args.entity_id, reason: 'no_grant' };
  }
  const obs = collectionLabelRatified(args.entity_id, args.label, args.value, args.ratified_by, nowIso);
  if (obs === null) {
    return { ok: false, entity_id: args.entity_id, reason: 'rejected_label' };
  }
  const appended = await store.appendObservationIfAbsent(obs, grant);
  return { ok: appended, entity_id: args.entity_id, ...(appended ? {} : { reason: 'append_failed' as const }) };
}
