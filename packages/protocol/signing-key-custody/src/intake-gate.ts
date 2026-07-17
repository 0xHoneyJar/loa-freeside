import type { KeyCustodyClass, TimeHealthSnapshot } from "./contracts.js";
import { KeyCustodyRejectedError } from "./errors.js";
import type { PinnedKeyRegistry } from "./registry.js";
import { assertSignedIntakeTimeHealthy } from "./time-health.js";

export interface GateSignedIntakeInput {
  readonly registry: PinnedKeyRegistry;
  readonly signingKeyId: string;
  readonly acceptedAtMs: number;
  readonly context: KeyCustodyClass;
  readonly timeHealth: TimeHealthSnapshot;
}

export interface SignedIntakeGateVerdict {
  readonly allowed: boolean;
  readonly reason?: KeyCustodyRejectedError["reason"];
  readonly remediation?: KeyCustodyRejectedError["remediation"];
}

export const gateSignedIntake = ({
  registry,
  signingKeyId,
  acceptedAtMs,
  context,
  timeHealth,
}: GateSignedIntakeInput): SignedIntakeGateVerdict => {
  try {
    assertSignedIntakeTimeHealthy(timeHealth);
    registry.resolveForIntake({ signingKeyId, acceptedAtMs, context });
    return { allowed: true };
  } catch (error) {
    if (error instanceof KeyCustodyRejectedError) {
      return {
        allowed: false,
        reason: error.reason,
        remediation: error.remediation,
      };
    }
    throw error;
  }
};

export const assertSignedIntakeAllowed = (input: GateSignedIntakeInput): void => {
  const verdict = gateSignedIntake(input);
  if (!verdict.allowed) {
    throw new KeyCustodyRejectedError({
      reason: verdict.reason ?? "database_clock_unknown",
      remediation: verdict.remediation,
    });
  }
};
