/**
 * S1-T4 (IMP-009 / IMP-002) — durable RoleSnapshot store: the WRITE side of the audit's role port.
 *
 * The exporter (freeside-characters) POSTs a Discord role export to `POST /v1/role-snapshot`; this HOLDS
 * the latest snapshot per `community` so the audit's read path (`RoleSource.load`) serves it. Until this
 * seam existed the snapshot could only arrive as a pre-placed file (`makeFileRoleSource`) — there was no
 * way for the exporter to feed one in. This closes that S1↔S3 gap.
 *
 * "DURABLE" = write-through to disk, so an ingested snapshot survives a replica restart: the audit must
 * never boot amnesiac and refuse every dogfood audit because its last snapshot lived only in RAM.
 *
 * loa:shortcut: filesystem-durable, single-replica. The ratified plan (IMP-002) suggested "reuse the
 *   profiles Postgres"; the audit service is deliberately dependency-free (file-backed RoleSource,
 *   in-memory event/rate state — see server.ts F4), so durability here is a write-through file, the SAME
 *   posture as the event store's in-memory shortcut. It satisfies the AC ("DURABLE state; holds latest
 *   per community") without bolting a DB onto a dependency-free service. Upgrade trigger: multi-replica
 *   ingestion (each replica would hold its own file) — then back this with the shared store keyed
 *   (community). Tracked deviation-with-rationale in the sprint report.
 */

import { timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { RoleSnapshotSchema, type RoleSnapshot } from './role-snapshot.js';
import type { RoleSource } from './audit-service.js';

/** The write side of the role port: persist the latest snapshot for its community. */
export interface RoleSink {
  /**
   * Persist `snap` as the latest for `snap.community`. Returns FALSE (no-op) when an equal-or-newer
   * snapshot is already held.
   *
   * MONOTONICITY is the contract: the store holds the LATEST per community. An unconditional overwrite
   * lets a delayed or replayed POST (both are valid, correctly-signed requests — at-least-once delivery
   * makes them expected, not exotic) roll the held snapshot BACKWARDS, so the audit would then compute
   * drift from stale role data. Compare `captured_at` and refuse to go back in time.
   */
  store(snap: RoleSnapshot): Promise<boolean>;
}

/** True iff `candidate` was captured strictly after `existing`. Equal timestamps are NOT newer (a replay). */
function isNewer(candidate: RoleSnapshot, existing: RoleSnapshot | undefined): boolean {
  if (!existing) return true;
  return Date.parse(candidate.captured_at) > Date.parse(existing.captured_at);
}

/** A store that is BOTH the audit's read port (`RoleSource`) and the ingestion write port (`RoleSink`). */
export interface DurableRoleStore extends RoleSource, RoleSink {}

/** Constant-time string compare (no length/timing oracle) — used for the ingestion service-token. */
export function timingSafeEqualStr(presented: string, expected: string): boolean {
  const p = Buffer.from(presented);
  const e = Buffer.from(expected);
  // Pad to the reference length so timingSafeEqual always runs; enforce length on the resulting booleans
  // (never short-circuit on length — that leaks the correct length as a timing oracle). Mirrors server.ts §12.3.
  const filled = Buffer.alloc(e.length, 0);
  p.copy(filled, 0, 0, Math.min(p.length, filled.length));
  const contentMatch = timingSafeEqual(filled, e);
  return contentMatch && p.length === e.length;
}

/** Per-community filename — sha256 of the community so an arbitrary community name can never traverse the
 *  data dir (the community is `z.string().min(1)`; a raw name could carry `/` or `..`). The community is
 *  recorded INSIDE the JSON, so the on-boot scan rebuilds the map from file contents, not the filename. */
function fileFor(dir: string, community: string): string {
  return join(dir, createHash('sha256').update(community).digest('hex').slice(0, 32) + '.json');
}

/**
 * In-memory latest-per-community + write-through to `dir`, seeded from disk on construction (durable).
 * `load()` serves the configured `community` (the operated community this deploy audits).
 */
export function makeDurableRoleStore(opts: { dir: string; community: string }): DurableRoleStore {
  const { dir, community } = opts;
  mkdirSync(dir, { recursive: true });
  const latest = new Map<string, RoleSnapshot>();

  // Seed from disk — a restart must recover the last-ingested snapshot, not start empty.
  for (const name of safeReaddir(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const snap = RoleSnapshotSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      latest.set(snap.community, snap);
    } catch {
      // A corrupt/foreign file must not crash boot; skip it (the next ingestion overwrites cleanly).
    }
  }

  return {
    async load(): Promise<RoleSnapshot | undefined> {
      return latest.get(community);
    },
    async store(snap: RoleSnapshot): Promise<boolean> {
      // Defensive re-validate (the route validates too) — a durable store must never persist a wrong shape.
      const valid = RoleSnapshotSchema.parse(snap);
      // MONOTONICITY: never roll the held snapshot backwards on a replayed/out-of-order POST.
      if (!isNewer(valid, latest.get(valid.community))) return false;
      const target = fileFor(dir, valid.community);
      const tmp = target + '.tmp';
      // Atomic write: full file to tmp, then rename — a concurrent load() never sees a torn snapshot.
      writeFileSync(tmp, JSON.stringify(valid), 'utf8');
      renameSync(tmp, target);
      latest.set(valid.community, valid);
      return true;
    },
  };
}

/** In-memory-only store (no disk) — for tests and single-process contexts that don't need restart durability. */
export function makeInMemoryRoleStore(loadCommunity: string): DurableRoleStore {
  const latest = new Map<string, RoleSnapshot>();
  return {
    async load(): Promise<RoleSnapshot | undefined> {
      return latest.get(loadCommunity);
    },
    async store(snap: RoleSnapshot): Promise<boolean> {
      const valid = RoleSnapshotSchema.parse(snap);
      if (!isNewer(valid, latest.get(valid.community))) return false; // never roll backwards
      latest.set(valid.community, valid);
      return true;
    },
  };
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
