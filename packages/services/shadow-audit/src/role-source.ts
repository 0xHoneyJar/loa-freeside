/**
 * Sprint 2 / S2-T1 — a real `RoleSource` (the audit's role-snapshot port), file-backed.
 *
 * Sprint 1 built `AuditService` against the `RoleSource` port but wired only a test fake; this is the
 * production adapter. It loads a dogfood community's Discord role export from a JSON path and
 * strict-validates it against `RoleSnapshotSchema` BEFORE returning — a malformed snapshot must never
 * silently serve a wrong confront-number (the audit's whole claim is the stale-access set).
 *
 * Two states, deliberately distinct:
 *   - no path configured  → `undefined` (the audit then refuses with `external-mode`: dogfood-full
 *     REQUIRES a role export; an absent one is a clean refusal, not an error).
 *   - path set but missing/invalid → THROWS (fail loud): a misconfigured deploy must surface, never
 *     degrade to "no snapshot" and serve a silently-wrong audit.
 *
 * A file holds ONE collection's export (S5-T1). Asked for a different collection, it serves `undefined`
 * — a clean refusal — rather than the wrong gate's role-holders.
 */

import { readFile } from 'node:fs/promises';
import { RoleSnapshotSchema, collectionKey, type RoleSnapshot } from './role-snapshot.js';
import type { RoleSource } from './audit-service.js';

export function makeFileRoleSource(path: string | undefined): RoleSource {
  return {
    async load(collection: string): Promise<RoleSnapshot | undefined> {
      if (!path) return undefined; // no export configured → external-mode refusal downstream
      const raw = await readFile(path, 'utf8'); // missing file → throws → fail loud (misconfig surfaces)
      const snap = RoleSnapshotSchema.parse(JSON.parse(raw)); // invalid shape → throws → never serve wrong data
      // The file is ONE collection's export. Serving it for another collection would audit this gate's
      // role-holders against that collection's on-chain holders — the silent-catastrophe class.
      return collectionKey(snap.collection) === collection.toLowerCase() ? snap : undefined;
    },
  };
}
