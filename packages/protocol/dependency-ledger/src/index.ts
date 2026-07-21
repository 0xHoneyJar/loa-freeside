/**
 * @freeside/dependency-ledger-protocol
 *
 * CR-012A public Ordering reverse-dependency ledger and inbox closure.
 */

export {
  DEPENDENCY_LEDGER_SCHEMA_MAJOR,
  DEPENDENCY_LEDGER_SCHEMA_MINOR,
  DEPENDENCY_EDGE_CONTRACT,
  DEPENDENCY_EDGE_CAPABILITY,
  DEPENDENCY_EDGE_SUPPORTED_MINOR,
  DEFAULT_EDGE_REPAIR_DEADLINE_MS,
} from "./version.js";

export {
  DependencyLedgerRejectedError,
  DependencyEdgeDecodeError,
} from "./errors.js";

export {
  strictDecodeOptions,
  ProducerWatermark,
  DerivativeRef,
  InvalidationPayload,
  DependencyEdgeBody,
  decodeDependencyEdgeBody,
  derivativeKey,
  type DerivativeFulfillmentState,
  type LedgerEdgeRecord,
  type DerivativeClosureRecord,
  type QuarantineMetrics,
  type DependencyLedgerInboxState,
  createDependencyLedgerInboxState,
} from "./contracts.js";

export {
  evaluateDerivativeClosure,
  applyCompromiseDenial,
  applyEquivalenceRevocation,
  recomputeMetrics,
  indexDerivativeEdge,
  refreshDerivativeClosure,
} from "./closure.js";

export {
  reconcileLedger,
  findOrphanEdges,
  type ReconciliationExpectation,
  type ReconciliationFinding,
  type ReconciliationReport,
} from "./reconciliation.js";

export {
  ingestDependencyEdgeEnvelope,
  type IngestDependencyEdgeInput,
  type IngestDependencyEdgeResult,
} from "./inbox.js";

export {
  buildDependencyLedgerFixtureRegistryDocument,
} from "./fixture-registry.js";
