/**
 * @freeside/shadow-audit-protocol
 *
 * Sealed Zod schemas + deterministic inputs_hash for the Shadow Access Audit
 * (the dogfood-NFT lead magnet). Schemas are `.strict()` — bands only, never a
 * numeric score (SDD §3, §11). Consumed by the audit service, the sonar/score
 * adapters, the gateway route, and the dashboard.
 */

export {
  EthAddressSchema,
  type EthAddress,
  ChainSchema,
  type Chain,
  BlockNumberSchema,
  BandSchema,
  type Band,
  RiskBandSchema,
  type RiskBand,
  AuditModeSchema,
  type AuditMode,
  SourceSchema,
  type Source,
} from './schemas/common.js';
export {
  SUPPORTED_GATING_KIND,
  GatingRuleSchema,
  type GatingRule,
  OrderSchema,
  type Order,
} from './schemas/order.js';
export {
  EvidenceSchema,
  type Evidence,
  ProvenanceSchema,
  type Provenance,
  AccessDecisionRecordSchema,
  type AccessDecisionRecord,
} from './schemas/access-decision-record.js';
// the pluggable POLICY seam — generalizes the audit's hard-coded `qualifies`. tokenGatingPolicy is the WIRED
// default (runAudit routes through it); badgePolicy is a verified REFERENCE policy, NOT yet wired (see its doc).
export { type AccessDecisionPort, tokenGatingPolicy, badgePolicy, type BadgeEvidence, type BadgeThresholds, type BadgeRole } from './access-decision-port.js';
export {
  CohortCountSchema,
  type CohortCount,
  AuditAggregateSchema,
  type AuditAggregate,
  CtaSchema,
  type Cta,
  MethodologySchema,
  type Methodology,
  AuditOutputSchema,
  type AuditOutput,
} from './schemas/audit-output.js';
// The DRIFT REPORT (S5-T4) — the assumption-free side-by-side + the two derived floors. The bound
// derivation is exported because it is ONE rule with TWO enforcement sites: the service produces with it,
// the schema re-derives with it and refuses anything else (see DriftReportSchema's superRefine).
export {
  SourceHoldersSchema,
  type SourceHolders,
  StaleFloorSchema,
  UndergrantFloorSchema,
  DriftReportSchema,
  type DriftReport,
  publicSourceBounds,
  staleFloorFrom,
  undergrantFloorFrom,
  STALE_FLOOR_ASSUMPTION,
  STALE_FLOOR_BREAKS_WHEN,
  UNDERGRANT_FLOOR_ASSUMPTION,
  UNDERGRANT_FLOOR_BREAKS_WHEN,
  DRIFT_DISCLOSURE,
} from './schemas/audit-output.js';
// Shadow Mode — the Comparison View + Discrepancy Report (the migration delta: promotion/demotion/no_change).
export {
  diffShadow,
  changeFromBand,
  ChangeSchema,
  type Change,
  MemberDiscrepancySchema,
  type MemberDiscrepancy,
  DiscrepancyReportSchema,
  type DiscrepancyReport,
} from './discrepancy.js';
export {
  RefusalCodeSchema,
  type RefusalCode,
  RefusalSchema,
  type Refusal,
  REFUSAL_HTTP_STATUS,
} from './schemas/refusal.js';
export { jcsCanonicalize, sha256Hex } from './jcs.js';
export {
  AuditSourceSchema,
  type AuditSource,
  AuditInputsSchema,
  type AuditInputs,
  SHADOW_AUDIT_PROTOCOL_VERSION,
  computeInputsHash,
} from './inputs-hash.js';
