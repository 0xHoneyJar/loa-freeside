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
 */

import { readFile } from 'node:fs/promises';
import { RoleSnapshotSchema, type RoleSnapshot } from './role-snapshot.js';
import type { RoleSource } from './audit-service.js';

export function makeFileRoleSource(path: string | undefined): RoleSource {
  return {
    async load(): Promise<RoleSnapshot | undefined> {
      if (!path) return undefined; // no export configured → external-mode refusal downstream
      const raw = await readFile(path, 'utf8'); // missing file → throws → fail loud (misconfig surfaces)
      return RoleSnapshotSchema.parse(JSON.parse(raw)); // invalid shape → throws → never serve wrong data
    },
  };
}
