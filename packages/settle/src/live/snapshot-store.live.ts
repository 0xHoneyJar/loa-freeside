/**
 * InMemorySnapshotStore — the MVP live store. (T1.6)
 *
 * Evidence-prep `put`s a signed snapshot; the sync gate `getSync`s it. In-memory
 * is sufficient for the single-session agent case this MVP targets; a durable
 * store (file/Redis) drops in behind the same SnapshotStore port without touching
 * the gate.
 */

import type { SnapshotStore } from "../ports/snapshot.port.js";
import type { SignedSnapshot } from "../domain/snapshot.js";

export class InMemorySnapshotStore implements SnapshotStore {
  private readonly map = new Map<string, SignedSnapshot>();

  put(signed: SignedSnapshot): void {
    this.map.set(signed.snapshot.claim_id, signed);
  }

  getSync(claimId: string): SignedSnapshot | null {
    return this.map.get(claimId) ?? null;
  }
}
