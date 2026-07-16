import { Schema } from "effect";
import type { EligibilityState, GateLeakRowReasonCode } from "./reason-codes.js";

/**
 * Migration contract from the existing Mibera Gate Leak behavior (the
 * shadow-audit discrepancy engine's `stale` / `missing` / `ok` bands over
 * `holds_role` x `qualifies`) onto the CR-002 one-directional tri-state.
 *
 * Ratified mapping:
 * - `ok` with definitive evidence      -> `eligible` (parity);
 * - `stale` with definitive evidence   -> `proven_ineligible` (parity: the
 *   confront set remains the actionable leak);
 * - `stale`/`ok` with missing authority -> `indeterminate`. This INTENTIONALLY
 *   replaces the legacy treatment of missing authority as a leak; it is the
 *   contract change, not an accident;
 * - `missing` (holdings WITHOUT the role — the legacy promotion direction)
 *   -> out of scope. V1 makes no claim about eligible holders who lack the
 *   role, so these records cannot map into any row or denominator.
 */

export const LegacyDiscrepancyBand = Schema.Literal("ok", "stale", "missing").annotations({
  identifier: "LegacyDiscrepancyBand",
});
export type LegacyDiscrepancyBand = Schema.Schema.Type<typeof LegacyDiscrepancyBand>;

export const LegacyEvidenceQuality = Schema.Literal(
  "definitive",
  "identity_link_missing",
  "consent_unavailable",
  "ownership_evidence_unavailable",
).annotations({ identifier: "LegacyEvidenceQuality" });
export type LegacyEvidenceQuality = Schema.Schema.Type<typeof LegacyEvidenceQuality>;

export const LegacyGateLeakRecord = Schema.Struct({
  schema_version: Schema.Literal(1),
  band: LegacyDiscrepancyBand,
  evidence: LegacyEvidenceQuality,
}).annotations({ identifier: "LegacyGateLeakRecord" });
export type LegacyGateLeakRecord = Schema.Schema.Type<typeof LegacyGateLeakRecord>;

export type MigratedGateLeakRecord =
  | {
      readonly in_scope: true;
      readonly eligibility_state: EligibilityState;
      readonly reason_code: GateLeakRowReasonCode;
      /** True when the new state differs from the legacy adverse treatment. */
      readonly replaces_legacy_leak_treatment: boolean;
    }
  | {
      readonly in_scope: false;
      readonly disposition: "out_of_scope_direction";
    };

export const migrateLegacyGateLeakRecord = (
  record: LegacyGateLeakRecord,
): MigratedGateLeakRecord => {
  if (record.band === "missing") {
    return { in_scope: false, disposition: "out_of_scope_direction" };
  }
  if (record.evidence === "definitive") {
    return record.band === "ok"
      ? {
          in_scope: true,
          eligibility_state: "eligible",
          reason_code: "eligible_balance_confirmed",
          replaces_legacy_leak_treatment: false,
        }
      : {
          in_scope: true,
          eligibility_state: "proven_ineligible",
          reason_code: "proven_zero_balance",
          replaces_legacy_leak_treatment: false,
        };
  }
  return {
    in_scope: true,
    eligibility_state: "indeterminate",
    reason_code: record.evidence,
    replaces_legacy_leak_treatment: record.band === "stale",
  };
};

export const decodeLegacyGateLeakRecord = Schema.decodeUnknown(LegacyGateLeakRecord, {
  errors: "all",
  onExcessProperty: "error",
});
