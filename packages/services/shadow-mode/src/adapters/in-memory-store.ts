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

export class InMemoryLedgerStore implements ILedgerStore {
  private readonly observations = new Map<string, ShadowObservation>();
  private readonly subjectsById = new Map<string, ShadowSubject>();
  private readonly aliasToSubject = new Map<string, string>();
  private readonly edgesById = new Map<string, ShadowEdge>();
  private readonly divergencesById = new Map<string, ShadowDivergence>();
  private readonly reportsById = new Map<string, ShadowReport>();

  appendObservationIfAbsent(observation: ShadowObservation): boolean {
    if (this.observations.has(observation.event_id)) return false;
    this.observations.set(observation.event_id, observation);
    return true;
  }

  withTransaction<T>(fn: () => T): T {
    // Single-threaded synchronous: the body runs to completion or throws (no
    // partial-await window). A throw leaves no partial commit because callers
    // mutate the in-memory maps only inside fn and we re-throw.
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
