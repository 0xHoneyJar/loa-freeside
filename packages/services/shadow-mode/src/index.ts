/**
 * @freeside/shadow-mode-service
 *
 * The shadow-mode ledger: reducer + ports + adapters + HTTP. Read-only: it
 * composes a member graph from upstream events and serves projections, mutating
 * nothing upstream (NFR-4). The fail-closed `StaticProducerPolicy` is the
 * default trust boundary (SDD §8).
 */

export { ShadowLedger, classifyDivergence, type IngestResult } from './shadow-ledger.js';
export type { ILedgerStore } from './ports/ledger-store.js';
export {
  type IProducerPolicy,
  type PolicyContext,
  type PolicyResult,
  type ProducerIdentity,
} from './ports/producer-policy.js';
export { InMemoryLedgerStore } from './adapters/in-memory-store.js';
export { StaticProducerPolicy } from './adapters/static-producer-policy.js';
export { AllowAllPolicy } from './adapters/allow-all-policy.js';
export { SvcJwtProducerPolicy, producerPolicyFromEnv } from './adapters/svc-jwt-policy.js';
export { JwtProducerPolicy } from './auth/jwt-producer-policy.js';
export { AppendGrant, operatorMigrationGrant } from './auth/append-grant.js';
export { buildAccessAuditReport, staleRiskBand } from './access-audit.js';
export { createShadowRouter, type ShadowRouterDeps } from './http/shadow-router.js';
export { demoEvents } from './fixtures.js';
