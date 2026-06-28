/**
 * Shadow Mode — the runner. Produce + persist a point-in-time Discrepancy Report, read-only.
 *
 * "ARRAKIS operates ALONGSIDE existing token-gating without modifying Discord roles" — so the runner
 * records what WOULD change (a `ShadowSnapshot`) and persists it; it never touches a role. The dashboard
 * reads the persisted SERIES (the Comparison View over time; the operator watches it converge before
 * going live). A cadence (cron / scheduled-cycle) fires `runShadow`; gathering the live audit records
 * (runAudit) is the caller's job, so the runner stays pure + testable. The concrete store (file /
 * EventStore / db) is an injected adapter — only laplas-gated, durable persistence touches the world.
 */
import { z } from 'zod';
import { AuditModeSchema, type AuditMode } from './schemas/common.js';
import type { AccessDecisionRecord } from './schemas/access-decision-record.js';
import { diffShadow, DiscrepancyReportSchema } from './discrepancy.js';

/** A point-in-time shadow report — the persisted artifact the dashboard reads (one per run). */
export const ShadowSnapshotSchema = z
  .object({
    community: z.string().min(1),
    mode: AuditModeSchema,
    /** ISO-8601 UTC instant the run was computed. */
    computed_at: z.string().datetime(),
    report: DiscrepancyReportSchema,
  })
  .strict();
export type ShadowSnapshot = z.infer<typeof ShadowSnapshotSchema>;

export interface ShadowRunInput {
  readonly community: string;
  readonly mode: AuditMode;
  readonly computed_at: string;
  readonly records: readonly AccessDecisionRecord[];
}

/** Produce a snapshot from the audit's records — pure (diffShadow + wrap). Read-only. */
export function toShadowSnapshot(input: ShadowRunInput): ShadowSnapshot {
  return ShadowSnapshotSchema.parse({
    community: input.community,
    mode: input.mode,
    computed_at: input.computed_at,
    report: diffShadow(input.records),
  });
}

/**
 * The persistence PORT. The runner appends snapshots; the dashboard reads the `series`. Concrete stores
 * (file / EventStore / db) are the integration adapter — the runner is pure over this port, so a cadence
 * can fire it against any backend.
 */
export interface ShadowStore {
  append(snapshot: ShadowSnapshot): Promise<void>;
  series(community: string): Promise<readonly ShadowSnapshot[]>;
  latest(community: string): Promise<ShadowSnapshot | undefined>;
}

/** An in-memory store — the test seam + the default for a single-process cadence. A durable file/db
 *  adapter is the integration step. */
export function makeMemoryStore(): ShadowStore {
  const byCommunity = new Map<string, ShadowSnapshot[]>();
  return {
    async append(s) {
      const arr = byCommunity.get(s.community) ?? [];
      arr.push(s);
      byCommunity.set(s.community, arr);
    },
    async series(c) {
      return [...(byCommunity.get(c) ?? [])];
    },
    async latest(c) {
      const arr = byCommunity.get(c);
      return arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
    },
  };
}

/**
 * runShadow — one shadow run: produce the snapshot, persist it, return it. READ-ONLY by construction: it
 * records what would change and appends to the store; it touches no Discord role. That is Shadow Mode's
 * whole promise — run alongside, show the discrepancy, change nothing until the operator goes live.
 */
export async function runShadow(input: ShadowRunInput, store: ShadowStore): Promise<ShadowSnapshot> {
  const snapshot = toShadowSnapshot(input);
  await store.append(snapshot);
  return snapshot;
}
