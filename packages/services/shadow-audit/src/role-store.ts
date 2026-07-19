/**
 * S1-T4 (IMP-009 / IMP-002) — durable RoleSnapshot store: the WRITE side of the audit's role port.
 *
 * The exporter (freeside-characters) POSTs a Discord role export to `POST /v1/role-snapshot`; this HOLDS
 * the latest snapshot per (community, collection) so the audit's read path (`RoleSource.load`) serves it.
 * Until this seam existed the snapshot could only arrive as a pre-placed file (`makeFileRoleSource`) —
 * there was no way for the exporter to feed one in. This closes that S1↔S3 gap.
 *
 * S5-T1 — the key is (community, COLLECTION), not community alone. thj gates SEVEN collections
 * (Honeycomb + HoneyJar1-6) behind SEVEN Discord roles, and the exporter exports one gated role-set at a
 * time. Keyed by community only, POSTing the HoneyJar1 export would OVERWRITE the Honeycomb one, and the
 * Honeycomb audit would then silently compute stale-access against HoneyJar1's role-holders. Monotonicity
 * is per-key for the same reason: a replayed POST for collection A must not roll back collection B, and a
 * newer snapshot for A must not be refused because B's is newer.
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
 *   (community, collection). Tracked deviation-with-rationale in the sprint report.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { RoleSnapshotSchema, type RoleSnapshot } from './role-snapshot.js';
import { canonicalCollectionKey, type SourceResolver } from './collection-union.js';
import type { RoleSource } from './audit-service.js';

/** The write side of the role port: persist the latest snapshot for its (community, collection). */
export interface RoleSink {
  /**
   * Persist `snap` as the latest for (`snap.community`, `snap.collection`). Returns FALSE (no-op) when an
   * equal-or-newer snapshot is already held FOR THAT SAME PAIR.
   *
   * MONOTONICITY is the contract: the store holds the LATEST per (community, collection). An unconditional
   * overwrite lets a delayed or replayed POST (both are valid, correctly-signed requests — at-least-once
   * delivery makes them expected, not exotic) roll the held snapshot BACKWARDS, so the audit would then
   * compute drift from stale role data. Compare `captured_at` WITHIN the key and refuse to go back in time.
   */
  store(snap: RoleSnapshot): Promise<boolean>;
}

/** Two different valid snapshots claim the same monotonic version. Retrying cannot resolve this. */
export class RoleSnapshotConflictError extends Error {
  readonly code = 'ROLE_SNAPSHOT_VERSION_CONFLICT';

  constructor() {
    super('role-store: conflicting valid snapshots share captured_at');
    this.name = 'RoleSnapshotConflictError';
  }
}

/** A snapshot names a deployment the audited collection index cannot resolve. Retrying cannot fix it. */
export class UndeclaredCollectionSourceError extends Error {
  readonly code = 'UNDECLARED_COLLECTION_SOURCE';

  constructor(chain: string, contract: string) {
    super(
      `role-store: ${chain}/${contract} is not a declared collection source — refusing to file a snapshot under a key no audit can read`,
    );
    this.name = 'UndeclaredCollectionSourceError';
  }
}

/** True iff `candidate` was captured strictly after `existing`. Equal timestamps are NOT newer (a replay). */
function isNewer(candidate: RoleSnapshot, existing: RoleSnapshot | undefined): boolean {
  if (!existing) return true;
  return Date.parse(candidate.captured_at) > Date.parse(existing.captured_at);
}

/** The store key: (community, collection) as ONE unambiguous string. JSON-encoded so a community name
 *  containing the separator cannot collide with a different (community, collection) pair. */
function keyFor(community: string, collection: string): string {
  return JSON.stringify([community, collection.toLowerCase()]);
}

/**
 * The key a snapshot files itself under — derived from the snapshot's OWN fields, never from the caller.
 *
 * The snapshot names ONE DEPLOYMENT (`{chain, contract}`) — as an exporter naturally would. It must be
 * filed under the CANONICAL COLLECTION key, because the audit looks it up by that: a collection is the
 * SET of its deployments, and any one of them merely ADDRESSES it. Filing by the deployment key means a
 * snapshot POSTed naming the berachain contract is invisible to an audit addressed via the ethereum
 * contract — it stores `200 {stored:true}` and then no audit can ever find it.
 *
 * That is not hypothetical: it is exactly what the first live probe after the sprint-5 deploy did. The
 * read path had been canonicalized and the WRITE path had not, and every unit test missed it because they
 * stub `RoleSource.load` directly and never exercise the store. Fakes pass; live finds it.
 */
export function canonicalRoleCollectionKey(snap: RoleSnapshot, sources: SourceResolver): string {
  const set = sources(snap.collection);
  // Unresolvable ⇒ the ingestion route already rejected it (422, registry-gated). Falling back to the
  // deployment key here would silently recreate the very bug this function exists to prevent, so refuse.
  if (!set || set.length === 0) {
    throw new UndeclaredCollectionSourceError(
      snap.collection.chain,
      snap.collection.contract,
    );
  }
  return canonicalCollectionKey(set);
}

function keyOf(snap: RoleSnapshot, sources: SourceResolver): string {
  return keyFor(snap.community, canonicalRoleCollectionKey(snap, sources));
}

/** A store that is BOTH the audit's read port (`RoleSource`) and the ingestion write port (`RoleSink`). */
export interface DurableRoleStore extends RoleSource, RoleSink {}

/** Per-(community, collection) filename — sha256 of the store key, so an arbitrary community or contract
 *  string can never traverse the data dir (both are caller-supplied; a raw name could carry `/` or `..`).
 *  Both fields are recorded INSIDE the JSON, so the on-boot scan rebuilds the map from file contents, not
 *  from the filename. */
function fileFor(dir: string, key: string): string {
  return join(dir, createHash('sha256').update(key).digest('hex').slice(0, 32) + '.json');
}

/** Atomic visibility plus crash durability: sync contents before rename, then sync the directory entry. */
function publishDurably(dir: string, target: string, tmp: string, body: string): void {
  const file = openSync(tmp, 'wx', 0o600);
  try {
    writeFileSync(file, body, 'utf8');
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  renameSync(tmp, target);
  const directory = openSync(dir, 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

/**
 * In-memory latest-per-(community, collection) + write-through to `dir`, seeded from disk on construction
 * (durable). `load(collection)` serves the configured `community`'s snapshot FOR THAT COLLECTION (the
 * operated community this deploy audits; the collection is the one the audit is running against).
 */
export function makeDurableRoleStore(opts: {
  dir: string;
  community: string;
  /** Resolves a deployment -> the collection's FULL source set, so snapshots are filed under the CANONICAL
   *  collection key the audit reads by (not the deployment key the exporter happened to name). */
  sources: SourceResolver;
}): DurableRoleStore {
  const { dir, community, sources } = opts;
  mkdirSync(dir, { recursive: true });
  const latest = new Map<string, RoleSnapshot>();
  const pending = new Map<string, Promise<boolean>>();

  // Seed from disk — a restart must recover the last-ingested snapshots, not start empty.
  for (const name of safeReaddir(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const snap = RoleSnapshotSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      latest.set(keyOf(snap, sources), snap);
    } catch (error) {
      // A corrupt/foreign file must not crash boot; skip it (the next ingestion overwrites cleanly).
      // NOTE (S5-T1): a snapshot written BEFORE `collection` existed on the wire lands here — it no longer
      // parses, so it is dropped rather than served under a guessed collection. Re-POST it (one exporter
      // command); the store is a cache of the exporter's output, never a source of truth.
      console.warn(
        JSON.stringify({
          event: 'role_snapshot_startup_skip',
          file: name,
          error_type: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  return {
    async load(collection: string): Promise<RoleSnapshot | undefined> {
      return latest.get(keyFor(community, collection));
    },
    async store(snap: RoleSnapshot): Promise<boolean> {
      // Defensive re-validate (the route validates too) — a durable store must never persist a wrong shape.
      const valid = RoleSnapshotSchema.parse(snap);
      const key = keyOf(valid, sources);
      const previous = pending.get(key) ?? Promise.resolve(false);
      const operation = previous
        .catch(() => false)
        .then(() => {
          // MONOTONICITY, WITHIN THE KEY: serialize the compare + publish operation so overlapping
          // at-least-once deliveries cannot both pass the same stale `latest` read.
          if (!isNewer(valid, latest.get(key))) return false;
          const target = fileFor(dir, key);
          const tmp = `${target}.${randomUUID()}.tmp`;
          try {
            // Crash-durable publish: sync the private file before rename, then sync the directory entry.
            publishDurably(dir, target, tmp, JSON.stringify(valid));
          } finally {
            rmSync(tmp, { force: true });
          }
          latest.set(key, valid);
          return true;
        });
      pending.set(key, operation);
      try {
        return await operation;
      } finally {
        if (pending.get(key) === operation) pending.delete(key);
      }
    },
  };
}

/** In-memory-only store (no disk) — for tests and single-process contexts that don't need restart durability. */
export function makeInMemoryRoleStore(loadCommunity: string, sources: SourceResolver): DurableRoleStore {
  const latest = new Map<string, RoleSnapshot>();
  return {
    async load(collection: string): Promise<RoleSnapshot | undefined> {
      return latest.get(keyFor(loadCommunity, collection));
    },
    async store(snap: RoleSnapshot): Promise<boolean> {
      const valid = RoleSnapshotSchema.parse(snap);
      const key = keyOf(valid, sources);
      if (!isNewer(valid, latest.get(key))) return false; // never roll THIS collection backwards
      latest.set(key, valid);
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
