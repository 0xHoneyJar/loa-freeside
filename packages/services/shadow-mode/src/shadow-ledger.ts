/**
 * ShadowLedger — the reducer (SDD §5). Ports the handoff reference impl behind
 * the ILedgerStore port, hardened per the flatline findings:
 *   - ingest is ATOMIC + TRANSACTIONAL (SKP-001/002/003)
 *   - observations are the append-only TRUTH; subjects are a derived projection
 *     (SKP-004) — merge mutates the projection, never the log
 *   - conservative merge records provenance; revoke DOWNGRADES verification
 *
 * It mutates NOTHING upstream (read-only building, NFR-4): it only reads events
 * and writes its own ledger via the store port.
 */

import {
  identityAlias,
  discordAlias,
  walletAlias,
  type ShadowEvent,
  type ShadowSubject,
  type ShadowEdge,
  type ShadowObservation,
  type ShadowDivergence,
  type DivergenceKind,
  type MemberGraphProjection,
  type SubjectKind,
  type WalletRef,
  type EventEnvelope,
  type DiscordMemberSnapshotPayload,
  type IdentityWalletLinkedPayload,
  type IdentityAccountLinkedPayload,
  type IdentityLinkRevokedPayload,
  type SonarWalletAttributedPayload,
  type IncumbentRoleObservedPayload,
  type FreesideRoleComputedPayload,
  type CommunityConfigUpdatedPayload,
} from '@freeside/shadow-mode-protocol';
import type { ILedgerStore } from './ports/ledger-store.js';

interface CommunityConfig {
  role_rank: Record<string, number>;
  watched_contracts: string[];
  incumbent_bot_ids: string[];
}

export type IngestResult =
  | { status: 'ingested'; event_id: string }
  | { status: 'duplicate'; event_id: string };

export class ShadowLedger {
  private readonly configs = new Map<string, CommunityConfig>();

  constructor(private readonly store: ILedgerStore) {}

  /** Idempotent, atomic, transactional ingest (AC-1). */
  async ingest(event: ShadowEvent): Promise<IngestResult> {
    return this.store.withTransaction(async () => {
      const observation: ShadowObservation = {
        event_id: event.event_id,
        community_id: event.community_id,
        name: event.name,
        source: event.source,
        truth_status: event.truth_status,
        observed_at: event.observed_at,
        emitted_at: event.emitted_at,
        evidence_ref: event.evidence_ref,
        payload: event.payload,
        ingested_at: new Date().toISOString(),
      };

      if (!(await this.store.appendObservationIfAbsent(observation))) {
        return { status: 'duplicate', event_id: event.event_id };
      }

      switch (event.name) {
        case 'discord.member.snapshot.v1':
          await this.applyDiscordMemberSnapshot(event);
          break;
        case 'identity.wallet.linked.v1':
          await this.applyIdentityWalletLinked(event);
          break;
        case 'identity.account.linked.v1':
          await this.applyIdentityAccountLinked(event);
          break;
        case 'identity.link.revoked.v1':
          await this.applyIdentityLinkRevoked(event);
          break;
        case 'sonar.wallet.attributed.v1':
          await this.applySonarWalletAttributed(event);
          break;
        case 'incumbent.role.observed.v1':
          await this.applyIncumbentRoleObserved(event);
          break;
        case 'freeside.role.computed.v1':
          await this.applyFreesideRoleComputed(event);
          break;
        case 'community.config.updated.v1':
          await this.applyCommunityConfigUpdated(event);
          break;
      }

      return { status: 'ingested', event_id: event.event_id };
    });
  }

  // --- projections (read-only) -----------------------------------------------

  async getMemberGraph(communityId: string): Promise<MemberGraphProjection> {
    const subjects = await this.store.subjects(communityId);
    const edges = await this.store.edges(communityId);
    const divergences = await this.store.divergences(communityId);
    return {
      community_id: communityId,
      subjects,
      edges,
      divergences,
      summary: {
        total_subjects: subjects.length,
        identity_users: subjects.filter((s) => s.kind === 'identity_user').length,
        discord_members: subjects.filter((s) => s.kind === 'discord_member').length,
        wallet_only: subjects.filter((s) => s.kind === 'wallet_only').length,
        unresolved: subjects.filter((s) => s.attribution_quality !== 'verified').length,
        divergences: divergences.filter((d) => d.kind !== 'match').length,
      },
    };
  }

  async getUnresolved(communityId: string): Promise<ShadowSubject[]> {
    return (await this.store.subjects(communityId)).filter((s) => s.attribution_quality !== 'verified');
  }

  async getDivergences(communityId: string): Promise<ShadowDivergence[]> {
    return this.store.divergences(communityId);
  }

  getConfig(communityId: string): CommunityConfig | undefined {
    return this.configs.get(communityId);
  }

  // --- apply handlers --------------------------------------------------------

  private async applyDiscordMemberSnapshot(
    event: EventEnvelope<'discord.member.snapshot.v1', DiscordMemberSnapshotPayload>,
  ): Promise<void> {
    const alias = discordAlias(event.payload.discord_user_id);
    const subject = await this.getOrCreateSubject(event.community_id, alias, 'discord_member', event.observed_at);
    subject.discord_user_id = event.payload.discord_user_id;
    subject.display_name = event.payload.display_name ?? subject.display_name;
    subject.current_roles = dedupe(event.payload.role_ids);
    subject.last_seen_at = event.observed_at;
    await this.store.upsertSubject(subject);
    await this.addAlias(subject, alias);
    await this.addEdge(event, subject.subject_id, 'discord_member_seen', { role_ids: event.payload.role_ids });
    await this.recomputeDivergence(subject);
  }

  private async applyIdentityWalletLinked(
    event: EventEnvelope<'identity.wallet.linked.v1', IdentityWalletLinkedPayload>,
  ): Promise<void> {
    const identity = await this.getOrCreateSubject(
      event.community_id,
      identityAlias(event.payload.user_id),
      'identity_user',
      event.observed_at,
    );
    identity.identity_user_id = event.payload.user_id;
    identity.kind = 'identity_user';
    identity.attribution_quality = 'verified';
    identity.wallets = addWallet(identity.wallets, event.payload.wallet);
    identity.last_seen_at = event.observed_at;
    await this.store.upsertSubject(identity);

    const existing = await this.store.findSubjectByAlias(event.community_id, walletAlias(event.payload.wallet));
    const conflicted = existing ? await this.mergeOrFlagConflict(identity, existing, event, 'wallet') : false;

    // On a contested wallet (another identity already owns it) leave the alias with
    // the original owner; only claim it when there was no conflict.
    if (!conflicted) await this.addAlias(identity, walletAlias(event.payload.wallet));
    await this.addEdge(event, identity.subject_id, 'identity_wallet_linked', {
      wallet: event.payload.wallet,
      proof_ref: event.payload.proof_ref,
    });
  }

  private async applyIdentityAccountLinked(
    event: EventEnvelope<'identity.account.linked.v1', IdentityAccountLinkedPayload>,
  ): Promise<void> {
    const identity = await this.getOrCreateSubject(
      event.community_id,
      identityAlias(event.payload.user_id),
      'identity_user',
      event.observed_at,
    );
    identity.identity_user_id = event.payload.user_id;
    identity.kind = 'identity_user';
    identity.attribution_quality = 'verified';
    identity.last_seen_at = event.observed_at;
    await this.store.upsertSubject(identity);

    if (event.payload.account_kind === 'discord') {
      identity.discord_user_id = event.payload.external_id;
      const existing = await this.store.findSubjectByAlias(
        event.community_id,
        discordAlias(event.payload.external_id),
      );
      const conflicted = existing ? await this.mergeOrFlagConflict(identity, existing, event, 'account') : false;
      if (!conflicted) await this.addAlias(identity, discordAlias(event.payload.external_id));
      await this.store.upsertSubject(identity);
    }

    await this.addEdge(event, identity.subject_id, `identity_${event.payload.account_kind}_linked`, {
      external_id: event.payload.external_id,
      proof_ref: event.payload.proof_ref,
    });
    await this.recomputeDivergence(identity);
  }

  /**
   * Revoke a previously verified link (FR-13, flatline SKP-004). MVP guarantees
   * DOWNGRADE + flag, not the full alias re-split cascade.
   */
  private async applyIdentityLinkRevoked(
    event: EventEnvelope<'identity.link.revoked.v1', IdentityLinkRevokedPayload>,
  ): Promise<void> {
    const identity = await this.store.findSubjectByAlias(
      event.community_id,
      identityAlias(event.payload.user_id),
    );
    if (identity) {
      identity.attribution_quality = 'observed_only';
      identity.pending_resplit = true;
      identity.last_seen_at = event.observed_at;
      await this.store.upsertSubject(identity);
      await this.addEdge(event, identity.subject_id, 'identity_link_revoked', {
        link_kind: event.payload.link_kind,
        reason: event.payload.reason,
      });
    }
  }

  private async applySonarWalletAttributed(
    event: EventEnvelope<'sonar.wallet.attributed.v1', SonarWalletAttributedPayload>,
  ): Promise<void> {
    const alias = walletAlias(event.payload.wallet);
    const subject = await this.getOrCreateSubject(event.community_id, alias, 'wallet_only', event.observed_at);
    subject.wallets = addWallet(subject.wallets, event.payload.wallet);
    subject.last_seen_at = event.observed_at;
    await this.store.upsertSubject(subject);
    await this.addAlias(subject, alias);
    await this.addEdge(event, subject.subject_id, `sonar_${event.payload.edge_kind}`, {
      wallet: event.payload.wallet,
      contract_address: event.payload.contract_address,
      token_id: event.payload.token_id,
      tx_hash: event.payload.tx_hash,
      block_number: event.payload.block_number,
    });
  }

  private async applyIncumbentRoleObserved(
    event: EventEnvelope<'incumbent.role.observed.v1', IncumbentRoleObservedPayload>,
  ): Promise<void> {
    const subject = await this.getOrCreateSubject(
      event.community_id,
      discordAlias(event.payload.discord_user_id),
      'discord_member',
      event.observed_at,
    );
    subject.discord_user_id = event.payload.discord_user_id;
    subject.incumbent_roles = dedupe(event.payload.role_ids);
    subject.last_seen_at = event.observed_at;
    await this.store.upsertSubject(subject);
    await this.addEdge(event, subject.subject_id, 'incumbent_roles_observed', {
      incumbent: event.payload.incumbent,
      role_ids: event.payload.role_ids,
    });
    await this.recomputeDivergence(subject);
  }

  private async applyFreesideRoleComputed(
    event: EventEnvelope<'freeside.role.computed.v1', FreesideRoleComputedPayload>,
  ): Promise<void> {
    const subject =
      (await this.findSubjectByLocator(event.community_id, event.payload.locator)) ??
      await this.getOrCreateSubject(
        event.community_id,
        // Stable on the locator (NOT event_id) so a re-emitted compute collapses
        // to the same unresolved subject under at-least-once delivery (FAGAN MEDIUM).
        unresolvedLocatorAlias(event.payload.locator, event.event_id),
        'unresolved',
        event.observed_at,
      );
    subject.freeside_roles = dedupe(event.payload.role_ids);
    subject.last_seen_at = event.observed_at;
    await this.store.upsertSubject(subject);
    await this.addEdge(event, subject.subject_id, 'freeside_roles_computed', {
      role_ids: event.payload.role_ids,
      reason: event.payload.reason,
    });
    await this.recomputeDivergence(subject);
  }

  private applyCommunityConfigUpdated(
    event: EventEnvelope<'community.config.updated.v1', CommunityConfigUpdatedPayload>,
  ): void {
    const existing = this.configs.get(event.community_id) ?? {
      role_rank: {},
      watched_contracts: [],
      incumbent_bot_ids: [],
    };
    this.configs.set(event.community_id, {
      role_rank: event.payload.role_rank ?? existing.role_rank,
      watched_contracts: event.payload.watched_contracts ?? existing.watched_contracts,
      incumbent_bot_ids: event.payload.incumbent_bot_ids ?? existing.incumbent_bot_ids,
    });
  }

  // --- helpers ---------------------------------------------------------------

  private async getOrCreateSubject(
    communityId: string,
    alias: string,
    kind: SubjectKind,
    observedAt: string,
  ): Promise<ShadowSubject> {
    const existing = await this.store.findSubjectByAlias(communityId, alias);
    if (existing) return existing;
    const subject: ShadowSubject = {
      subject_id: `${communityId}:${alias}`,
      community_id: communityId,
      kind,
      wallets: [],
      aliases: [],
      current_roles: [],
      incumbent_roles: [],
      freeside_roles: [],
      attribution_quality:
        kind === 'identity_user' ? 'verified' : kind === 'unresolved' ? 'unresolved' : 'observed_only',
      last_seen_at: observedAt,
    };
    await this.store.upsertSubject(subject);
    await this.addAlias(subject, alias);
    return subject;
  }

  private async addAlias(subject: ShadowSubject, alias: string): Promise<void> {
    if (!subject.aliases.includes(alias)) subject.aliases.push(alias);
    await this.store.upsertAlias(subject.community_id, alias, subject.subject_id);
    await this.store.upsertSubject(subject);
  }

  private async findSubjectByLocator(
    communityId: string,
    locator: { user_id?: string; discord_user_id?: string; wallet?: WalletRef },
  ): Promise<ShadowSubject | undefined> {
    if (locator.user_id) return this.store.findSubjectByAlias(communityId, identityAlias(locator.user_id));
    if (locator.discord_user_id)
      return this.store.findSubjectByAlias(communityId, discordAlias(locator.discord_user_id));
    if (locator.wallet) return this.store.findSubjectByAlias(communityId, walletAlias(locator.wallet));
    return undefined;
  }

  /**
   * Merge `existing` into `identity` ONLY when `existing` is not itself a
   * verified identity. An identity-vs-identity conflict (a wallet/account linked
   * to one identity is now linked to another) is NEVER silently absorbed
   * (account-takeover-shaped, FAGAN HIGH) — it records a conflict edge and
   * leaves both subjects intact for an operator/identity-api to resolve.
   */
  /** Returns true if a conflict was flagged (no merge happened) — caller then
   *  leaves the contested alias with the original owner. */
  private async mergeOrFlagConflict(
    identity: ShadowSubject,
    existing: ShadowSubject,
    event: ShadowEvent,
    linkKind: 'wallet' | 'account',
  ): Promise<boolean> {
    if (existing.subject_id === identity.subject_id) return false;
    if (existing.kind === 'identity_user') {
      await this.addEdge(event, identity.subject_id, `identity_conflict_${linkKind}`, {
        conflicting_subject_id: existing.subject_id,
        conflicting_identity_user_id: existing.identity_user_id,
      });
      return true; // contested: do NOT re-point the alias to this identity
    }
    await this.mergeSubjects(identity, existing, event.event_id, linkKind);
    return false;
  }

  private async mergeSubjects(
    preferred: ShadowSubject,
    other: ShadowSubject,
    eventId: string,
    linkKind: 'wallet' | 'account',
  ): Promise<void> {
    preferred.wallets = mergeWallets(preferred.wallets, other.wallets);
    preferred.aliases = dedupe([...preferred.aliases, ...other.aliases]);
    preferred.current_roles = dedupe([...preferred.current_roles, ...other.current_roles]);
    preferred.incumbent_roles = dedupe([...preferred.incumbent_roles, ...other.incumbent_roles]);
    preferred.freeside_roles = dedupe([...preferred.freeside_roles, ...other.freeside_roles]);
    preferred.discord_user_id = preferred.discord_user_id ?? other.discord_user_id;
    preferred.display_name = preferred.display_name ?? other.display_name;
    preferred.attribution_quality = 'verified';
    preferred.last_seen_at = maxIso(preferred.last_seen_at, other.last_seen_at);
    preferred.merge_provenance = [
      ...(preferred.merge_provenance ?? []),
      { event_id: eventId, link_kind: linkKind, identity_user_id: preferred.identity_user_id ?? '' },
    ];

    for (const alias of other.aliases) {
      await this.store.upsertAlias(preferred.community_id, alias, preferred.subject_id);
    }
    await this.store.reassignEdges(other.subject_id, preferred.subject_id);
    // Drop the absorbed subject's divergence so no row dangles at a deleted
    // subject (in-memory: double-count; Postgres: FK violation aborts the merge).
    await this.store.deleteDivergence(`${other.community_id}:${other.subject_id}`);
    await this.store.deleteSubject(other.subject_id);
    await this.store.upsertSubject(preferred);
    await this.recomputeDivergence(preferred);
  }

  private async addEdge(
    event: ShadowEvent,
    subjectId: string,
    edgeKind: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const edgeId = `${event.event_id}:${edgeKind}`;
    if (await this.store.hasEdge(edgeId)) return;
    const edge: ShadowEdge = {
      edge_id: edgeId,
      community_id: event.community_id,
      subject_id: subjectId,
      source: event.source,
      edge_kind: edgeKind,
      truth_status: event.truth_status,
      observed_at: event.observed_at,
      evidence_ref: event.evidence_ref,
      data,
    };
    await this.store.upsertEdge(edge);
  }

  private async recomputeDivergence(subject: ShadowSubject): Promise<void> {
    if (!subject.incumbent_roles.length && !subject.freeside_roles.length) return;
    const config = this.configs.get(subject.community_id);
    const kind = classifyDivergence(subject.incumbent_roles, subject.freeside_roles, config?.role_rank ?? {});
    const divergenceId = `${subject.community_id}:${subject.subject_id}`;
    await this.store.upsertDivergence({
      divergence_id: divergenceId,
      community_id: subject.community_id,
      subject_id: subject.subject_id,
      kind,
      incumbent_roles: [...subject.incumbent_roles],
      freeside_roles: [...subject.freeside_roles],
      reason: divergenceReason(kind),
      observed_at: new Date().toISOString(),
    });
  }
}

// --- pure helpers ------------------------------------------------------------

export function classifyDivergence(
  incumbentRoles: string[],
  freesideRoles: string[],
  roleRank: Record<string, number>,
): DivergenceKind {
  if (sameSet(incumbentRoles, freesideRoles)) return 'match';
  const incumbentMax = maxRank(incumbentRoles, roleRank);
  const freesideMax = maxRank(freesideRoles, roleRank);
  if (freesideMax > incumbentMax) return 'freeside_higher';
  if (incumbentMax > freesideMax) return 'incumbent_higher';
  return 'mismatch';
}

function divergenceReason(kind: DivergenceKind): string {
  switch (kind) {
    case 'match':
      return 'Incumbent and Freeside role sets match.';
    case 'freeside_higher':
      return 'Freeside would grant a higher ranked role than the incumbent.';
    case 'incumbent_higher':
      return 'Incumbent grants a higher ranked role than Freeside would.';
    case 'mismatch':
      return 'Role sets differ without a rank-only explanation.';
  }
}

/** A stable unresolved-subject alias derived from the locator (idempotent on retry). */
function unresolvedLocatorAlias(
  locator: { user_id?: string; discord_user_id?: string; wallet?: WalletRef },
  eventId: string,
): string {
  if (locator.user_id) return `unresolved:u:${locator.user_id}`;
  if (locator.discord_user_id) return `unresolved:d:${locator.discord_user_id}`;
  if (locator.wallet) return `unresolved:${walletAlias(locator.wallet)}`;
  return `unresolved:e:${eventId}`;
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function sameSet(a: string[], b: string[]): boolean {
  const aa = dedupe(a).sort();
  const bb = dedupe(b).sort();
  return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
}

function maxRank(roles: string[], roleRank: Record<string, number>): number {
  return roles.reduce((max, role) => Math.max(max, roleRank[role] ?? 0), 0);
}

function addWallet(wallets: WalletRef[], wallet: WalletRef): WalletRef[] {
  return mergeWallets(wallets, [wallet]);
}

function mergeWallets(a: WalletRef[], b: WalletRef[]): WalletRef[] {
  const seen = new Map<string, WalletRef>();
  for (const wallet of [...a, ...b]) seen.set(walletAlias(wallet), wallet);
  return [...seen.values()];
}

function maxIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
