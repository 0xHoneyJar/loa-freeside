import { Schema } from "effect";

/**
 * Safe public reason codes owned by the Gate Leak recipe (CR-002).
 *
 * Ordering's generic lifecycle reasons (`preparation_failed`,
 * `capacity_unavailable`, `report_failed`, `retry_exhausted`, …) remain SDD
 * section 13 property; this module ratifies only the codes the Gate Leak
 * capabilities introduce, at two surfaces:
 *
 * - order/readiness surface: admission refusals, remediation states, and
 *   result presentation;
 * - row surface: the versioned per-record reason allowlist.
 *
 * Every entry carries machine-checkable safety metadata. The standing
 * invariants (enforced by schema filters and tests, not prose):
 *
 * - only `proven_zero_balance` is actionable; every `indeterminate` code is a
 *   coverage gap and never an adverse inference;
 * - no code or copy implies the out-of-scope direction (eligible holders who
 *   lack the role);
 * - consent missing/refused/withdrawn/revoked collapse into ONE code so the
 *   refusal channel cannot leak which subjects declined (sibling-channel
 *   discipline).
 */

export const GateLeakOrderReasonCode = Schema.Literal(
  "unsupported_gate_rule",
  "gate_mapping_not_ratified",
  "gate_mapping_revoked",
  "gate_mapping_malformed",
  "mapping_integrity_violation",
  "gate_config_ratify_required",
  "identity_reveal_not_authorized",
  "mapping_churn_limit_exceeded",
  "report_churn_limit_exceeded",
  "purpose_policy_missing",
  "consent_purpose_mismatch",
  "empty_deployment_selection",
  "partial_deployment_coverage",
  "evidence_scope_mismatch",
  "evidence_version_below_floor",
  "compute_input_binding_mismatch",
  "restricted_evidence_expired",
  "evidence_window_misaligned",
  "ownership_evidence_stale",
  "ownership_finality_unproven",
  "discord_snapshot_stale",
  "identity_snapshot_stale",
  "watermark_mutation_restart",
  "capture_contention",
  "identity_invalidation_stale",
  "authorization_revoked",
  "cohort_too_large",
  "insufficient_coverage",
).annotations({ identifier: "GateLeakOrderReasonCode" });
export type GateLeakOrderReasonCode = Schema.Schema.Type<
  typeof GateLeakOrderReasonCode
>;

/** Stable public ordering for refusal arrays; declaration order is protocol order. */
export const GATE_LEAK_ORDER_REASON_CODE_ORDER: ReadonlyArray<GateLeakOrderReasonCode> =
  Object.freeze([
    "unsupported_gate_rule",
    "gate_mapping_not_ratified",
    "gate_mapping_revoked",
    "gate_mapping_malformed",
    "mapping_integrity_violation",
    "gate_config_ratify_required",
    "identity_reveal_not_authorized",
    "mapping_churn_limit_exceeded",
    "report_churn_limit_exceeded",
    "purpose_policy_missing",
    "consent_purpose_mismatch",
    "empty_deployment_selection",
    "partial_deployment_coverage",
    "evidence_scope_mismatch",
    "evidence_version_below_floor",
    "compute_input_binding_mismatch",
    "restricted_evidence_expired",
    "evidence_window_misaligned",
    "ownership_evidence_stale",
    "ownership_finality_unproven",
    "discord_snapshot_stale",
    "identity_snapshot_stale",
    "watermark_mutation_restart",
    "capture_contention",
    "identity_invalidation_stale",
    "authorization_revoked",
    "cohort_too_large",
    "insufficient_coverage",
  ]);

export const orderGateLeakOrderReasonCodes = (
  reasonCodes: ReadonlySet<GateLeakOrderReasonCode>,
): ReadonlyArray<GateLeakOrderReasonCode> =>
  Object.freeze(
    GATE_LEAK_ORDER_REASON_CODE_ORDER.filter((reasonCode) =>
      reasonCodes.has(reasonCode),
    ),
  );

export const GateLeakRowReasonCode = Schema.Literal(
  "eligible_balance_confirmed",
  "proven_zero_balance",
  "identity_link_missing",
  "consent_unavailable",
  "identity_unavailable",
  "ownership_evidence_unavailable",
  "authority_evidence_unavailable",
).annotations({ identifier: "GateLeakRowReasonCode" });
export type GateLeakRowReasonCode = Schema.Schema.Type<typeof GateLeakRowReasonCode>;

export const EligibilityState = Schema.Literal(
  "eligible",
  "proven_ineligible",
  "indeterminate",
).annotations({ identifier: "EligibilityState" });
export type EligibilityState = Schema.Schema.Type<typeof EligibilityState>;

export interface OrderReasonCodeEntry {
  /** Which lifecycle surface may emit the code. */
  readonly surface: "admission" | "remediation" | "needs_attention" | "result";
  /** Honest copy safe for an unauthenticated-shape projection. */
  readonly safe_public_copy: string;
  /** Whether automatic retry is permitted, per the SDD failure model. */
  readonly retry: "none" | "automatic" | "operator";
}

export const GATE_LEAK_ORDER_REASON_CODES: Readonly<
  Record<GateLeakOrderReasonCode, OrderReasonCodeEntry>
> = Object.freeze({
  unsupported_gate_rule: {
    surface: "admission",
    safe_public_copy:
      "This gate rule is outside V1 support. V1 checks only: holds at least one item from the selected collection.",
    retry: "none",
  },
  gate_mapping_not_ratified: {
    surface: "admission",
    safe_public_copy:
      "No operator-ratified collection-to-role mapping exists for this community. An authorized community operator must confirm the mapping first.",
    retry: "none",
  },
  gate_mapping_revoked: {
    surface: "needs_attention",
    safe_public_copy:
      "The ratified collection-to-role mapping for this order was revoked. An authorized operator must review and explicitly relink it.",
    retry: "operator",
  },
  gate_mapping_malformed: {
    surface: "needs_attention",
    safe_public_copy:
      "The stored collection-to-role mapping is in an invalid state and cannot be used. An authorized operator must review it before ordering.",
    retry: "operator",
  },
  mapping_integrity_violation: {
    surface: "needs_attention",
    safe_public_copy:
      "The ratified mapping configuration failed integrity verification and cannot be used. An authorized operator must review and re-ratify it.",
    retry: "operator",
  },
  gate_config_ratify_required: {
    surface: "admission",
    safe_public_copy:
      "Confirming a collection-to-role mapping requires the gate-config:ratify permission. Ask an authorized community operator.",
    retry: "none",
  },
  identity_reveal_not_authorized: {
    surface: "result",
    safe_public_copy:
      "Identity rows for this new mapping are withheld until independent integration evidence or a second privacy approver confirms it.",
    retry: "operator",
  },
  mapping_churn_limit_exceeded: {
    surface: "admission",
    safe_public_copy:
      "This community reached its rolling 24-hour limit for new mapping versions. Raising the limit requires privacy review.",
    retry: "none",
  },
  report_churn_limit_exceeded: {
    surface: "admission",
    safe_public_copy:
      "This community reached its rolling 24-hour limit for distinct-collection Gate Leak orders.",
    retry: "none",
  },
  purpose_policy_missing: {
    surface: "admission",
    safe_public_copy:
      "The versioned community_gate_audit consent purpose is not configured for this community. Configure the named requirement before ordering.",
    retry: "none",
  },
  consent_purpose_mismatch: {
    surface: "remediation",
    safe_public_copy:
      "Identity-link evidence was captured under a different consent purpose policy version than this order requires. Acquisition restarts against the current policy.",
    retry: "automatic",
  },
  empty_deployment_selection: {
    surface: "admission",
    safe_public_copy:
      "This order names no selected deployments. A Gate Leak report requires at least one selected deployment; an empty selection can never produce findings.",
    retry: "none",
  },
  partial_deployment_coverage: {
    surface: "remediation",
    safe_public_copy:
      "Ownership evidence does not cover every selected deployment and this recipe does not permit partial coverage.",
    retry: "automatic",
  },
  evidence_scope_mismatch: {
    surface: "remediation",
    safe_public_copy:
      "Presented evidence is scoped to a different community, guild, role set, collection, or mapping version than this order. Acquisition restarts against the correct scope.",
    retry: "automatic",
  },
  evidence_version_below_floor: {
    surface: "remediation",
    safe_public_copy:
      "Presented evidence was produced by an adapter or contract version below this recipe's floor. Acquisition restarts against a current producer.",
    retry: "automatic",
  },
  compute_input_binding_mismatch: {
    surface: "remediation",
    safe_public_copy:
      "The compute input does not bind the exact pinned evidence envelopes and watermarks for this attempt. The attempt restarts against consistent evidence.",
    retry: "automatic",
  },
  restricted_evidence_expired: {
    surface: "remediation",
    safe_public_copy:
      "Restricted evidence for this order passed its retention bound and can no longer be used. Acquisition restarts.",
    retry: "automatic",
  },
  evidence_window_misaligned: {
    surface: "remediation",
    safe_public_copy:
      "Ownership, Discord, and identity evidence windows could not be aligned within the five-minute policy. Acquisition restarts.",
    retry: "automatic",
  },
  ownership_evidence_stale: {
    surface: "remediation",
    safe_public_copy:
      "Ownership evidence is older than the recipe's finality and max-source-age policy relative to evaluation time. Re-acquire ownership against a current source head.",
    retry: "automatic",
  },
  ownership_finality_unproven: {
    surface: "remediation",
    safe_public_copy:
      "Ownership evidence does not prove finalized source identity for every selected deployment under the recipe's closed finality policy. Re-acquire ownership with exact per-deployment finality attestations.",
    retry: "automatic",
  },
  discord_snapshot_stale: {
    surface: "remediation",
    safe_public_copy:
      "The Discord role snapshot is older than the recipe's snapshot freshness bound relative to evaluation time. Re-acquire a current role snapshot.",
    retry: "automatic",
  },
  identity_snapshot_stale: {
    surface: "remediation",
    safe_public_copy:
      "The identity-link snapshot is older than the Identity propagation objective relative to evaluation time. Re-acquire a current link snapshot.",
    retry: "automatic",
  },
  watermark_mutation_restart: {
    surface: "remediation",
    safe_public_copy:
      "A tracked configuration, consent, identity, or authority change occurred before finalization. The attempt restarts against current evidence.",
    retry: "automatic",
  },
  capture_contention: {
    surface: "remediation",
    safe_public_copy:
      "The Discord role snapshot could not stabilize within the bounded capture attempts. Operator review is required.",
    retry: "operator",
  },
  identity_invalidation_stale: {
    surface: "remediation",
    safe_public_copy:
      "Identity invalidation events are delayed beyond policy. The order waits for reconciliation.",
    retry: "automatic",
  },
  authorization_revoked: {
    surface: "needs_attention",
    safe_public_copy:
      "Authorization backing this restricted work was revoked. Restricted work detached pending explicit reauthorization.",
    retry: "operator",
  },
  cohort_too_large: {
    surface: "remediation",
    safe_public_copy:
      "The mapped-role cohort exceeds the V1 subject ceiling. The cohort is never truncated; the order needs remediation.",
    retry: "operator",
  },
  insufficient_coverage: {
    surface: "result",
    safe_public_copy:
      "Definitive coverage of the mapped-role cohort is below the release threshold, so the actionable measure is suppressed. Indeterminate records are a coverage gap, not findings.",
    retry: "none",
  },
});

export interface RowReasonCodeEntry {
  readonly eligibility_state: EligibilityState;
  /** True only for the single V1 leak finding. */
  readonly actionable: boolean;
  /** Indeterminate codes must never read as adverse inference. */
  readonly adverse_inference: false;
  /** Whether the row may carry compared wallet addresses. */
  readonly wallets: "required" | "forbidden";
  readonly safe_public_copy: string;
}

export const GATE_LEAK_ROW_REASON_CODES: Readonly<
  Record<GateLeakRowReasonCode, RowReasonCodeEntry>
> = Object.freeze({
  eligible_balance_confirmed: {
    eligibility_state: "eligible",
    actionable: false,
    adverse_inference: false,
    wallets: "required",
    safe_public_copy:
      "A consented linked wallet holds at least one item from the selected collection.",
  },
  proven_zero_balance: {
    eligibility_state: "proven_ineligible",
    actionable: true,
    adverse_inference: false,
    wallets: "required",
    safe_public_copy:
      "Every consented linked wallet was proven to hold zero items across every selected deployment within the evidence window.",
  },
  identity_link_missing: {
    eligibility_state: "indeterminate",
    actionable: false,
    adverse_inference: false,
    wallets: "forbidden",
    safe_public_copy:
      "No linked wallet is available for this member. This is a coverage gap, not a finding.",
  },
  consent_unavailable: {
    eligibility_state: "indeterminate",
    actionable: false,
    adverse_inference: false,
    wallets: "forbidden",
    safe_public_copy:
      "No qualifying community_gate_audit consent is available for this member. This is a coverage gap, not a finding.",
  },
  identity_unavailable: {
    eligibility_state: "indeterminate",
    actionable: false,
    adverse_inference: false,
    wallets: "forbidden",
    safe_public_copy:
      "This member's identity record is unavailable. This is a coverage gap, not a finding.",
  },
  ownership_evidence_unavailable: {
    eligibility_state: "indeterminate",
    actionable: false,
    adverse_inference: false,
    wallets: "forbidden",
    safe_public_copy:
      "Ownership evidence for this member's linked wallets is stale or incomplete. This is a coverage gap, not a finding.",
  },
  authority_evidence_unavailable: {
    eligibility_state: "indeterminate",
    actionable: false,
    adverse_inference: false,
    wallets: "forbidden",
    safe_public_copy:
      "Authority evidence required to evaluate this member is stale or incomplete. This is a coverage gap, not a finding.",
  },
});

export const GATE_LEAK_SCOPE_STATEMENT = Object.freeze({
  in_scope:
    "Among non-bot members who currently hold the mapped Discord role: eligible, proven_ineligible, or indeterminate.",
  actionable: "Only proven_ineligible records are actionable leak findings.",
  out_of_scope:
    "Eligible holders who lack the Discord role are outside this report's claim and must not be implied by copy or completeness metrics.",
});
