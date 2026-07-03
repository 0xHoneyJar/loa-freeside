/**
 * InMemoryLedgerStore — the reference Map-backed store (SDD §4).
 *
 * `appendObservationIfAbsent` is a single SYNCHRONOUS check-and-set (no await
 * between read and write), so it is atomic under JS's single-threaded event
 * loop — concurrent delivery of the same event_id applies exactly once
 * (flatline SKP-001/002). `withTransaction` is a synchronous passthrough here;
 * the Postgres adapter makes it a real DB transaction.
 */

import type { ILedgerStore } from '../ports/ledger-store.js';
import type {
  ShadowObservation,
  ShadowSubject,
  ShadowEdge,
  ShadowDivergence,
  ShadowReport,
} from '@freeside/shadow-mode-protocol';
import {
  ChainFrozenError,
  chainLink,
  genesisObservation,
  verifyChain as verifyLinks,
  type ChainLink,
  type ChainVerdict,
} from '../chain.js';

interface FreezeState {
  first_bad_seq: number;
  reason: string;
  cleared?: { cleared_by: string; rationale: string };
}

export class InMemoryLedgerStore implements ILedgerStore {
  private readonly observations = new Map<string, ShadowObservation>();
  private readonly subjectsById = new Map<string, ShadowSubject>();
  private readonly aliasToSubject = new Map<string, string>();
  private readonly edgesById = new Map<string, ShadowEdge>();
  private readonly divergencesById = new Map<string, ShadowDivergence>();
  private readonly reportsById = new Map<string, ShadowReport>();
  private readonly chains = new Map<string, ChainLink[]>();
  /** Append-only freeze/clear history per chain (last entry uncleared = frozen). */
  private readonly freezeLog = new Map<string, FreezeState[]>();

  appendObservationIfAbsent(observation: ShadowObservation): boolean {
    if (this.observations.has(observation.event_id)) return false;
    const chainId = observation.community_id;
    const active = this.activeFreeze(chainId);
    if (active) throw new ChainFrozenError(chainId, active.first_bad_seq);
    let links = this.chains.get(chainId);
    if (!links) {
      // Lazy genesis: seq 0 is the sentinel; the incoming observation is seq 1.
      const genesis = genesisObservation(chainId, observation.ingested_at);
      this.observations.set(genesis.event_id, genesis);
      links = [chainLink(chainId, null, genesis)];
      this.chains.set(chainId, links);
    }
    this.observations.set(observation.event_id, observation);
    links.push(chainLink(chainId, links[links.length - 1], observation));
    return true;
  }

  getChainHead(chainId: string): ChainLink | undefined {
    const links = this.chains.get(chainId);
    return links?.[links.length - 1];
  }

  verifyChain(chainId: string): ChainVerdict {
    const links = this.chains.get(chainId) ?? [];
    const verdict = verifyLinks(links, (eventId) => this.observations.get(eventId));
    if (!verdict.ok && !this.isChainFrozen(chainId)) {
      const log = this.freezeLog.get(chainId) ?? [];
      log.push({ first_bad_seq: verdict.first_bad_seq, reason: verdict.reason });
      this.freezeLog.set(chainId, log);
    }
    return verdict;
  }

  isChainFrozen(chainId: string): boolean {
    return this.activeFreeze(chainId) !== undefined;
  }

  clearChainFreeze(chainId: string, clearedBy: string, rationale: string): void {
    const active = this.activeFreeze(chainId);
    if (!active) return;
    // Append-only: the clear is recorded ON the freeze entry, never deleted.
    active.cleared = { cleared_by: clearedBy, rationale };
  }

  private activeFreeze(chainId: string): FreezeState | undefined {
    const log = this.freezeLog.get(chainId);
    const last = log?.[log.length - 1];
    return last && !last.cleared ? last : undefined;
  }

  /** Test/verification seam: expose links + observation lookup (read-only). */
  chainLinks(chainId: string): readonly ChainLink[] {
    return this.chains.get(chainId) ?? [];
  }

  getObservation(eventId: string): ShadowObservation | undefined {
    return this.observations.get(eventId);
  }

  /** Test seam ONLY: corrupt a stored observation to exercise tamper detection. */
  unsafeMutateObservationForTest(eventId: string, mutate: (o: ShadowObservation) => void): void {
    const o = this.observations.get(eventId);
    if (o) mutate(o);
  }

  withTransaction<T>(fn: () => T): T {
    // Single-threaded synchronous: no partial-await window (no concurrent
    // interleaving). loa:shortcut: this does NOT roll back already-applied
    // mutations if fn throws mid-way — the in-memory adapter has no undo log.
    // Apply handlers run only on Zod-validated input so no throw path is known,
    // but the Postgres adapter MUST provide real transactional rollback.
    // Upgrade trigger: the Postgres adapter, or any apply handler that can throw.
    return fn();
  }

  getSubject(subjectId: string): ShadowSubject | undefined {
    return this.subjectsById.get(subjectId);
  }

  findSubjectByAlias(communityId: string, alias: string): ShadowSubject | undefined {
    const id = this.aliasToSubject.get(`${communityId}:${alias}`);
    return id ? this.subjectsById.get(id) : undefined;
  }

  upsertSubject(subject: ShadowSubject): void {
    this.subjectsById.set(subject.subject_id, subject);
  }

  deleteSubject(subjectId: string): void {
    this.subjectsById.delete(subjectId);
  }

  upsertAlias(communityId: string, alias: string, subjectId: string): void {
    this.aliasToSubject.set(`${communityId}:${alias}`, subjectId);
  }

  hasEdge(edgeId: string): boolean {
    return this.edgesById.has(edgeId);
  }

  upsertEdge(edge: ShadowEdge): void {
    this.edgesById.set(edge.edge_id, edge);
  }

  reassignEdges(fromSubjectId: string, toSubjectId: string): void {
    for (const edge of this.edgesById.values()) {
      if (edge.subject_id === fromSubjectId) edge.subject_id = toSubjectId;
    }
  }

  upsertDivergence(divergence: ShadowDivergence): void {
    this.divergencesById.set(divergence.divergence_id, divergence);
  }

  deleteDivergence(divergenceId: string): void {
    this.divergencesById.delete(divergenceId);
  }

  upsertReport(report: ShadowReport): void {
    this.reportsById.set(report.report_id, report);
  }

  subjects(communityId: string): ShadowSubject[] {
    return [...this.subjectsById.values()].filter((s) => s.community_id === communityId);
  }

  edges(communityId: string): ShadowEdge[] {
    return [...this.edgesById.values()].filter((e) => e.community_id === communityId);
  }

  divergences(communityId: string): ShadowDivergence[] {
    return [...this.divergencesById.values()].filter((d) => d.community_id === communityId);
  }
}
