/** In-memory SnapshotStore double. (T1.2) */
import type { SnapshotStore } from "../ports/snapshot.port.js";
import type { SignedSnapshot } from "../domain/snapshot.js";

export class MockSnapshotStore implements SnapshotStore {
  private readonly map = new Map<string, SignedSnapshot>();

  put(signed: SignedSnapshot): void {
    this.map.set(signed.snapshot.claim_id, signed);
  }

  getSync(claimId: string): SignedSnapshot | null {
    return this.map.get(claimId) ?? null;
  }
}
