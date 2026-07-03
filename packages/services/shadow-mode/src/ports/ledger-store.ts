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
  CollectionEntity,
} from '@freeside/shadow-mode-protocol';
import type { ChainLink, ChainVerdict } from '../chain.js';
import type { AppendGrant } from '../auth/append-grant.js';

export interface ILedgerStore {
  /** Atomic insert-if-absent. Returns true iff newly inserted (idempotency, AC-1). Append-only. */
  appendObservationIfAbsent(observation: ShadowObservation, grant: AppendGrant): Promise<boolean>;

  /** Run a unit of work atomically (in-memory: synchronous passthrough; Postgres: a DB tx). */
  withTransaction<T>(fn: () => Promise<T> | T): Promise<T>;

  // --- subjects (derived projection) ---
  getSubject(subjectId: string): Promise<ShadowSubject | undefined>;
  findSubjectByAlias(communityId: string, alias: string): Promise<ShadowSubject | undefined>;
  upsertSubject(subject: ShadowSubject): Promise<void>;
  /** Used ONLY by conservative merge to absorb a subject (projection-only; observations remain). */
  deleteSubject(subjectId: string): Promise<void>;
  upsertAlias(communityId: string, alias: string, subjectId: string): Promise<void>;

  // --- edges ---
  hasEdge(edgeId: string): Promise<boolean>;
  upsertEdge(edge: ShadowEdge): Promise<void>;
  reassignEdges(fromSubjectId: string, toSubjectId: string): Promise<void>;

  // --- divergences / reports ---
  upsertDivergence(divergence: ShadowDivergence): Promise<void>;
  /** Drop a divergence (used by merge to avoid a row dangling at an absorbed subject). */
  deleteDivergence(divergenceId: string): Promise<void>;
  upsertReport(report: ShadowReport): Promise<void>;

  // --- community-scoped projections ---
  subjects(communityId: string): Promise<ShadowSubject[]>;
  edges(communityId: string): Promise<ShadowEdge[]>;
  divergences(communityId: string): Promise<ShadowDivergence[]>;

  // --- collection labelled-entities (SDD collections-sot §2) ---
  // Collection observations reuse `appendObservationIfAbsent` (community_id =
  // entity_id → the collection's OWN worldline). These reads FOLD that chain
  // into the current projection — the chain stays the source of truth.
  /** Fold a collection's worldline into its current entity, or undefined if none. */
  getCollectionEntity(entityId: string): Promise<CollectionEntity | undefined>;
  /** Every collection entity that has at least one label observation. */
  listCollectionEntities(): Promise<CollectionEntity[]>;

  // --- hash chain (SDD sandwich-line §6a; chain_id = community_id) ---
  /** Head link of the chain, undefined if the chain has no links yet. */
  getChainHead(chainId: string): Promise<ChainLink | undefined>;
  /** Recompute every hash from genesis; a failure freezes the chain. */
  verifyChain(chainId: string): Promise<ChainVerdict>;
  isChainFrozen(chainId: string): Promise<boolean>;
  /** Operator-only; writes an append-only clear record. Never called by services. */
  clearChainFreeze(chainId: string, clearedBy: string, rationale: string): Promise<void>;
}
