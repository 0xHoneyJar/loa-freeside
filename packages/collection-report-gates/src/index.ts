/**
 * @freeside/collection-report-gates
 *
 * CR-019 — machine-readable release-gate manifest for the collection-report
 * cycle. Gate evaluation is executable: the manifest enumerates every gate,
 * every canonical CR ID (suffixed IDs explicit, ranges forbidden), owner
 * roles, evidence validity, dependency gates, states, tier consequences,
 * and controlled feature flags; the validator rejects the full CR-019
 * rejection matrix deterministically.
 */

export {
  GateManifest,
  decodeGateManifest,
  decodeGateManifestSync,
  decodeGateManifestEither,
  Task,
  Gate,
  Tier,
  Checkpoint,
  FeatureFlag,
  ManifestApproval,
  ApprovalAuthority,
  ApprovalKeyring,
  RepositoryAcceptanceReceipt,
  RepositoryAcceptanceReceipts,
  RepositoryAcceptanceAuthority,
  RepositoryAcceptanceKeyring,
  Evidence,
  Validity,
  GateState,
  EvidenceKind,
  STATIC_EVIDENCE_KINDS,
  DYNAMIC_EVIDENCE_KINDS,
  type GateManifestT,
  type TaskT,
  type GateT,
  type TierT,
  type CheckpointT,
  type FeatureFlagT,
  type EvidenceT,
  type ValidityT,
  type GateStateT,
  type EvidenceKindT,
  type ManifestApprovalT,
  type ApprovalAuthorityT,
  type ApprovalKeyringT,
  type RepositoryAcceptanceReceiptT,
  type RepositoryAcceptanceReceiptsT,
  type RepositoryAcceptanceAuthorityT,
  type RepositoryAcceptanceKeyringT,
  decodeApprovalKeyringSync,
  decodeRepositoryAcceptanceReceiptsSync,
  decodeRepositoryAcceptanceKeyringSync,
} from "./schema.js";

export {
  approvalSigningPayload,
  computeApprovalManifestDigest,
  expectedApprovalKeyId,
  verifyManifestApproval,
  repositoryAcceptanceSigningPayload,
  verifyRepositoryAcceptance,
} from "./approval.js";

export {
  validateGateManifest,
  scanRawTaskRefs,
  flattenTaskManifest,
  type Finding,
  type FindingCode,
  type ValidationResult,
  type TierReport,
  type SourceInventory,
  type ApprovalAuthorityRecord,
  type ApprovalAuthorities,
  type FlattenedTaskManifest,
  type RepositoryAcceptanceAuthorityRecord,
  type RepositoryAcceptanceAuthorities,
} from "./validate.js";

export {
  TASK_ID_PATTERN,
  GATE_ID_PATTERN,
  ROLE_PATTERN,
  isRangeShaped,
  implicitSuffixVariants,
} from "./ids.js";
