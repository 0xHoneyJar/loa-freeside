import type {
  CompromiseEvent,
  CustodySigningKey,
  RevocationEvent,
  RotationEvent,
} from "./contracts.js";
import { KeyCustodyRejectedError } from "./errors.js";
import { PinnedKeyRegistry } from "./registry.js";

export interface RotationCoordinator {
  readonly registryId: string;
  applyRotation(event: RotationEvent, keys: readonly CustodySigningKey[]): readonly CustodySigningKey[];
  applyRevocation(event: RevocationEvent, keys: readonly CustodySigningKey[]): readonly CustodySigningKey[];
  applyCompromise(event: CompromiseEvent, keys: readonly CustodySigningKey[]): readonly CustodySigningKey[];
}

export const validateRotationOverlap = (
  event: RotationEvent,
  registry: PinnedKeyRegistry,
  atMs: number,
): void => {
  const overlapStart = Date.parse(event.overlap_starts_at);
  const overlapEnd = Date.parse(event.overlap_ends_at);
  if (overlapEnd <= overlapStart) {
    throw new KeyCustodyRejectedError({
      reason: "rotation_overlap_invalid",
      remediation: "rotate_signing_key",
    });
  }

  if (atMs < overlapStart || atMs > overlapEnd) {
    return;
  }

  if (!registry.overlappingRotationWindow(event.previous_key_id, event.next_key_id, atMs)) {
    throw new KeyCustodyRejectedError({
      reason: "rotation_overlap_invalid",
      remediation: "rotate_signing_key",
    });
  }
};

export const applyRevocationToKeys = (
  event: RevocationEvent,
  keys: readonly CustodySigningKey[],
): readonly CustodySigningKey[] =>
  keys.map((key) =>
    key.signing_key_id === event.signing_key_id
      ? { ...key, revoked_at: event.revoked_at, compromise: key.compromise ?? false }
      : key,
  );

export const applyCompromiseToKeys = (
  event: CompromiseEvent,
  keys: readonly CustodySigningKey[],
): readonly CustodySigningKey[] =>
  keys.map((key) =>
    key.signing_key_id === event.signing_key_id
      ? {
          ...key,
          compromise: true,
          revoked_at: key.revoked_at ?? event.detected_at,
        }
      : key,
  );

export const createInMemoryRotationCoordinator = (registryId: string): RotationCoordinator => ({
  registryId,
  applyRotation: (_event, keys) => keys,
  applyRevocation: (event, keys) => applyRevocationToKeys(event, keys),
  applyCompromise: (event, keys) => applyCompromiseToKeys(event, keys),
});

export interface EmergencyRevocationPlan {
  readonly registry_id: string;
  readonly compromised_key_ids: readonly string[];
  readonly revoke_at: string;
  readonly quarantine_signed_intake: true;
}

export const buildEmergencyRevocationPlan = (
  registryId: string,
  compromisedKeyIds: readonly string[],
  revokeAtIso: string,
): EmergencyRevocationPlan => ({
  registry_id: registryId,
  compromised_key_ids: compromisedKeyIds,
  revoke_at: revokeAtIso,
  quarantine_signed_intake: true,
});
