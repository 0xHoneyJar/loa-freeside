/**
 * ILedgerStore — the persistence port (SDD §4).
 *
 * The store exposes NO method that mutates an upstream source (NFR-4 by
 * construction). `appendObservationIfAbsent` is ATOMIC (flatline SKP-001/002):
 * it is the idempotency check, returning true iff the observation was newly
 * inserted — there is no separate check-then-act window. The reducer runs its
 * projection updates inside `withTransaction` so observation + graph mutations
 * commit together (flatline SKP-003).
 */

import type {
  ShadowObservation,
  ShadowSubject,
  ShadowEdge,
  ShadowDivergence,
  ShadowReport,
} from '@freeside/shadow-mode-protocol';
import type { ChainLink, ChainVerdict } from '../chain.js';

export interface ILedgerStore {
  /** Atomic insert-if-absent. Returns true iff newly inserted (idempotency, AC-1). Append-only. */
  appendObservationIfAbsent(observation: ShadowObservation): boolean;

  /** Run a unit of work atomically (in-memory: synchronous passthrough; Postgres: a DB tx). */
  withTransaction<T>(fn: () => T): T;

  // --- subjects (derived projection) ---
  getSubject(subjectId: string): ShadowSubject | undefined;
  findSubjectByAlias(communityId: string, alias: string): ShadowSubject | undefined;
  upsertSubject(subject: ShadowSubject): void;
  /** Used ONLY by conservative merge to absorb a subject (projection-only; observations remain). */
  deleteSubject(subjectId: string): void;
  upsertAlias(communityId: string, alias: string, subjectId: string): void;

  // --- edges ---
  hasEdge(edgeId: string): boolean;
  upsertEdge(edge: ShadowEdge): void;
  reassignEdges(fromSubjectId: string, toSubjectId: string): void;

  // --- divergences / reports ---
  upsertDivergence(divergence: ShadowDivergence): void;
  /** Drop a divergence (used by merge to avoid a row dangling at an absorbed subject). */
  deleteDivergence(divergenceId: string): void;
  upsertReport(report: ShadowReport): void;

  // --- community-scoped projections ---
  subjects(communityId: string): ShadowSubject[];
  edges(communityId: string): ShadowEdge[];
  divergences(communityId: string): ShadowDivergence[];

  // --- hash chain (SDD sandwich-line §6a; chain_id = community_id) ---
  /** Head link of the chain, undefined if the chain has no links yet. */
  getChainHead(chainId: string): ChainLink | undefined;
  /** Recompute every hash from genesis; a failure freezes the chain. */
  verifyChain(chainId: string): ChainVerdict;
  isChainFrozen(chainId: string): boolean;
  /** Operator-only; writes an append-only clear record. Never called by services. */
  clearChainFreeze(chainId: string, clearedBy: string, rationale: string): void;
}
