/**
 * CR-201A shared preparation store port + in-memory reference backend.
 *
 * Proves transactional join/create, lease fencing, retry CAS, subscriber fan-in,
 * and deterministic zero-subscriber abandonment without remote calls under lock.
 */

import { randomUUID } from "node:crypto";
import {
  deploymentSetDigest,
  digestPublicWorkKey,
  finalityPolicyVersion,
} from "./shared-preparation-work-key.js";
import {
  isActivePublicWorkState,
  type PreparationWorkItemRecord,
  type PublicPreparationWorkKeyMaterial,
  type PublicWorkState,
  type ReadinessEvidenceEnvelope,
  type ReportWorkLinkRecord,
  type SharedPreparationWorkRecord,
} from "./shared-preparation-types.js";

export class SharedPreparationFencingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedPreparationFencingError";
  }
}

export class SharedPreparationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedPreparationStateError";
  }
}

export interface JoinPublicWorkInput {
  readonly order_id: string;
  readonly order_tenant_scope_digest: string;
  readonly work_key: PublicPreparationWorkKeyMaterial;
  readonly now_ms: number;
}

export type JoinPublicWorkResult =
  | {
      readonly kind: "joined";
      readonly work: SharedPreparationWorkRecord;
      readonly links: readonly ReportWorkLinkRecord[];
      readonly created: boolean;
      readonly reused_ready: boolean;
    }
  | { readonly kind: "serialization_retry" };

export interface SharedPreparationStore {
  joinPublicWork(input: JoinPublicWorkInput): Promise<JoinPublicWorkResult>;
  getWork(workId: string): Promise<SharedPreparationWorkRecord | undefined>;
  listActiveLinks(workId: string): Promise<readonly ReportWorkLinkRecord[]>;
  listWorkItems(workId: string): Promise<readonly PreparationWorkItemRecord[]>;
  acquireLease(input: {
    work_id: string;
    worker_id: string;
    lease_duration_ms: number;
    now_ms: number;
  }): Promise<
    | { readonly kind: "acquired"; readonly work: SharedPreparationWorkRecord }
    | { readonly kind: "reclaimed"; readonly work: SharedPreparationWorkRecord }
    | { readonly kind: "busy" }
    | { readonly kind: "not_active" }
  >;
  transitionToPreparing(input: {
    work_id: string;
    expected_lease_epoch: number;
    now_ms: number;
  }): Promise<SharedPreparationWorkRecord>;
  recordRetryableFailure(input: {
    work_id: string;
    expected_lease_epoch: number;
    next_attempt_at_unix_ms: number;
    retry_deadline_unix_ms: number;
    failure: { code: string; reason: string };
    now_ms: number;
  }): Promise<SharedPreparationWorkRecord>;
  wakeRetryWait(input: {
    work_id: string;
    /** CAS token: wake only when attempt still matches the scheduled failure. */
    expected_attempt: number;
    now_ms: number;
  }): Promise<
    | { readonly kind: "woke"; readonly work: SharedPreparationWorkRecord }
    | { readonly kind: "stale_wake" }
  >;
  publishChildEvidence(input: {
    work_item_id: string;
    expected_lease_epoch: number;
    evidence: ReadinessEvidenceEnvelope;
    now_ms: number;
  }): Promise<PreparationWorkItemRecord>;
  finalizeReadyIfQualified(input: {
    work_id: string;
    expected_lease_epoch: number;
    readiness_evidence: ReadinessEvidenceEnvelope;
    now_ms: number;
  }): Promise<
    | { readonly kind: "ready"; readonly work: SharedPreparationWorkRecord }
    | { readonly kind: "pending_children"; readonly work: SharedPreparationWorkRecord }
  >;
  detachSubscriber(input: {
    order_id: string;
    work_id: string;
    now_ms: number;
  }): Promise<
    | { readonly kind: "detached"; readonly work?: SharedPreparationWorkRecord }
    | { readonly kind: "not_linked" }
    | { readonly kind: "serialization_retry" }
  >;
  supersedeActiveGeneration(input: {
    work_key_digest: string;
    now_ms: number;
  }): Promise<SharedPreparationWorkRecord | undefined>;
}

type MutableWork = {
  -readonly [K in keyof SharedPreparationWorkRecord]: SharedPreparationWorkRecord[K];
};
type MutableItem = {
  -readonly [K in keyof PreparationWorkItemRecord]: PreparationWorkItemRecord[K];
};
type MutableLink = {
  -readonly [K in keyof ReportWorkLinkRecord]: ReportWorkLinkRecord[K];
};

function cloneWork(work: MutableWork): SharedPreparationWorkRecord {
  return structuredClone(work);
}

function cloneItem(item: MutableItem): PreparationWorkItemRecord {
  return structuredClone(item);
}

function cloneLink(link: MutableLink): ReportWorkLinkRecord {
  return structuredClone(link);
}

function allChildrenReady(items: readonly MutableItem[]): boolean {
  return items.length > 0 && items.every((item) => item.state === "ready");
}

/** Same freshness gate join uses when reusing a ready row. */
export function assertReadinessEvidenceQualified(
  evidence: ReadinessEvidenceEnvelope,
): void {
  if (evidence.freshness.qualified !== true) {
    throw new SharedPreparationStateError(
      "finalize ready requires readiness_evidence.freshness.qualified",
    );
  }
  if (evidence.privacy_scope !== "public_chain") {
    throw new SharedPreparationStateError(
      "finalize ready requires public_chain privacy_scope",
    );
  }
}

export class InMemorySharedPreparationStore implements SharedPreparationStore {
  private readonly works = new Map<string, MutableWork>();
  private readonly items = new Map<string, MutableItem>();
  private readonly links = new Map<string, MutableLink>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly maxSerializationRetries = 8;

  private linkKey(orderId: string, workId: string): string {
    return `${orderId}\0${workId}`;
  }

  private async withWorkKeyLock<T>(
    workKeyDigest: string,
    fn: () => Promise<T>,
  ): Promise<T | { kind: "serialization_retry" }> {
    const prior = this.locks.get(workKeyDigest) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(workKeyDigest, prior.then(() => gate));

    await prior;
    try {
      for (let attempt = 0; attempt < this.maxSerializationRetries; attempt += 1) {
        try {
          return await fn();
        } catch (err) {
          if (
            err instanceof Error &&
            err.message === "serialization_retry" &&
            attempt + 1 < this.maxSerializationRetries
          ) {
            continue;
          }
          throw err;
        }
      }
      return { kind: "serialization_retry" };
    } finally {
      release();
      if (this.locks.get(workKeyDigest) === gate) {
        this.locks.delete(workKeyDigest);
      }
    }
  }

  /** Serialize all work mutations under the same work-key lock as join/detach. */
  private async withWorkIdLock<T>(
    workId: string,
    fn: () => Promise<T>,
  ): Promise<T | { kind: "serialization_retry" } | undefined> {
    const work = this.works.get(workId);
    if (!work) return undefined;
    return this.withWorkKeyLock(work.work_key_digest, fn);
  }

  private unwrapLocked<T>(
    locked: T | { kind: "serialization_retry" } | undefined,
    missing: () => T,
  ): T {
    if (locked === undefined) return missing();
    if (
      locked &&
      typeof locked === "object" &&
      "kind" in locked &&
      (locked as { kind: string }).kind === "serialization_retry"
    ) {
      throw new SharedPreparationStateError("work-key lock serialization exhausted");
    }
    return locked as T;
  }

  private rowsForKey(workKeyDigest: string): MutableWork[] {
    return [...this.works.values()].filter((row) => row.work_key_digest === workKeyDigest);
  }

  private activeRow(workKeyDigest: string): MutableWork | undefined {
    return this.rowsForKey(workKeyDigest).find((row) => isActivePublicWorkState(row.state));
  }

  private highestReadyRow(
    workKeyDigest: string,
    readinessPolicyVersion: string,
  ): MutableWork | undefined {
    const ready = this.rowsForKey(workKeyDigest)
      .filter(
        (row) =>
          row.state === "ready" &&
          row.readiness_policy_version === readinessPolicyVersion &&
          row.readiness_evidence?.freshness.qualified === true,
      )
      .sort((a, b) => b.generation - a.generation);
    return ready[0];
  }

  private itemsForWork(workId: string): MutableItem[] {
    return [...this.items.values()].filter((item) => item.work_id === workId);
  }

  private activeLinksForWork(workId: string): MutableLink[] {
    return [...this.links.values()].filter(
      (link) => link.work_id === workId && link.detached_at_unix_ms === undefined,
    );
  }

  private createWorkAndChildren(input: {
    work_key: PublicPreparationWorkKeyMaterial;
    generation: number;
    now_ms: number;
  }): MutableWork {
    const workId = `spw_${randomUUID()}`;
    const workKeyDigest = digestPublicWorkKey(input.work_key);
    const work: MutableWork = {
      work_id: workId,
      work_key_digest: workKeyDigest,
      deployment_set_digest: deploymentSetDigest(input.work_key.deployment_ids),
      capability: input.work_key.capability,
      capability_version: input.work_key.capability_version,
      scope_class: "deployment",
      scope_digest: input.work_key.scope_digest,
      privacy_class: "public_chain",
      source_identity: structuredClone(input.work_key.source_identity),
      readiness_policy_version: input.work_key.readiness_policy_version,
      evidence_boundary_kind: input.work_key.evidence_boundary_kind,
      ...(input.work_key.evidence_boundary_digest !== undefined
        ? { evidence_boundary_digest: input.work_key.evidence_boundary_digest }
        : {}),
      adapter_version: input.work_key.adapter_version,
      finality_policy_version: finalityPolicyVersion(input.work_key.finality_policies),
      state: "queued",
      generation: input.generation,
      attempt: 0,
      lease_epoch: 0,
      sharing_scope_kind: "public",
      created_at_unix_ms: input.now_ms,
      updated_at_unix_ms: input.now_ms,
    };
    this.works.set(workId, work);
    for (const deploymentId of input.work_key.deployment_ids) {
      const itemId = `pwi_${randomUUID()}`;
      const item: MutableItem = {
        work_item_id: itemId,
        work_id: workId,
        deployment_id: structuredClone(deploymentId),
        capability: input.work_key.capability,
        adapter_version: input.work_key.adapter_version,
        state: "queued",
        attempt: 0,
        lease_epoch: 0,
        created_at_unix_ms: input.now_ms,
        updated_at_unix_ms: input.now_ms,
      };
      this.items.set(itemId, item);
    }
    return work;
  }

  private attachLink(input: {
    order_id: string;
    work_id: string;
    generation: number;
    order_tenant_scope_digest: string;
    now_ms: number;
  }): ReportWorkLinkRecord {
    const key = this.linkKey(input.order_id, input.work_id);
    const existing = this.links.get(key);
    if (existing && existing.detached_at_unix_ms === undefined) {
      return cloneLink(existing);
    }
    const link: MutableLink = {
      order_id: input.order_id,
      work_id: input.work_id,
      joined_at_unix_ms: input.now_ms,
      generation: input.generation,
      order_tenant_scope_digest: input.order_tenant_scope_digest,
      sharing_scope_kind: "public",
    };
    this.links.set(key, link);
    return cloneLink(link);
  }

  async joinPublicWork(input: JoinPublicWorkInput): Promise<JoinPublicWorkResult> {
    const workKeyDigest = digestPublicWorkKey(input.work_key);
    const locked = await this.withWorkKeyLock(workKeyDigest, async () => {
      const ready = this.highestReadyRow(workKeyDigest, input.work_key.readiness_policy_version);
      if (ready) {
        this.attachLink({
          order_id: input.order_id,
          work_id: ready.work_id,
          generation: ready.generation,
          order_tenant_scope_digest: input.order_tenant_scope_digest,
          now_ms: input.now_ms,
        });
        return {
          kind: "joined" as const,
          work: cloneWork(ready),
          links: this.activeLinksForWork(ready.work_id).map(cloneLink),
          created: false,
          reused_ready: true,
        };
      }

      const active = this.activeRow(workKeyDigest);
      if (active) {
        this.attachLink({
          order_id: input.order_id,
          work_id: active.work_id,
          generation: active.generation,
          order_tenant_scope_digest: input.order_tenant_scope_digest,
          now_ms: input.now_ms,
        });
        return {
          kind: "joined" as const,
          work: cloneWork(active),
          links: this.activeLinksForWork(active.work_id).map(cloneLink),
          created: false,
          reused_ready: false,
        };
      }

      const prior = this.rowsForKey(workKeyDigest);
      const generation = prior.reduce((max, row) => Math.max(max, row.generation), 0) + 1;
      if (this.activeRow(workKeyDigest)) {
        throw new Error("serialization_retry");
      }
      const created = this.createWorkAndChildren({
        work_key: input.work_key,
        generation,
        now_ms: input.now_ms,
      });
      this.attachLink({
        order_id: input.order_id,
        work_id: created.work_id,
        generation: created.generation,
        order_tenant_scope_digest: input.order_tenant_scope_digest,
        now_ms: input.now_ms,
      });
      return {
        kind: "joined" as const,
        work: cloneWork(created),
        links: this.activeLinksForWork(created.work_id).map(cloneLink),
        created: true,
        reused_ready: false,
      };
    });

    if (locked && typeof locked === "object" && "kind" in locked && locked.kind === "serialization_retry") {
      return locked;
    }
    return locked as JoinPublicWorkResult;
  }

  async getWork(workId: string): Promise<SharedPreparationWorkRecord | undefined> {
    const work = this.works.get(workId);
    return work ? cloneWork(work) : undefined;
  }

  async listActiveLinks(workId: string): Promise<readonly ReportWorkLinkRecord[]> {
    return this.activeLinksForWork(workId).map(cloneLink);
  }

  async listWorkItems(workId: string): Promise<readonly PreparationWorkItemRecord[]> {
    return this.itemsForWork(workId).map(cloneItem);
  }

  async acquireLease(input: {
    work_id: string;
    worker_id: string;
    lease_duration_ms: number;
    now_ms: number;
  }): Promise<
    | { readonly kind: "acquired"; readonly work: SharedPreparationWorkRecord }
    | { readonly kind: "reclaimed"; readonly work: SharedPreparationWorkRecord }
    | { readonly kind: "busy" }
    | { readonly kind: "not_active" }
  > {
    type LeaseResult =
      | { readonly kind: "acquired"; readonly work: SharedPreparationWorkRecord }
      | { readonly kind: "reclaimed"; readonly work: SharedPreparationWorkRecord }
      | { readonly kind: "busy" }
      | { readonly kind: "not_active" };
    const locked = await this.withWorkIdLock(input.work_id, async (): Promise<LeaseResult> => {
      const work = this.works.get(input.work_id);
      if (!work || !isActivePublicWorkState(work.state)) {
        return { kind: "not_active" };
      }
      const leaseExpired =
        work.lease_until_unix_ms === undefined || input.now_ms >= work.lease_until_unix_ms;
      if (!leaseExpired && work.lease_until_unix_ms !== undefined) {
        return { kind: "busy" };
      }
      const reclaimed = leaseExpired && work.lease_until_unix_ms !== undefined;
      work.lease_epoch += 1;
      work.lease_until_unix_ms = input.now_ms + input.lease_duration_ms;
      work.updated_at_unix_ms = input.now_ms;
      for (const item of this.itemsForWork(work.work_id)) {
        item.lease_epoch = work.lease_epoch;
        item.updated_at_unix_ms = input.now_ms;
      }
      return {
        kind: reclaimed ? "reclaimed" : "acquired",
        work: cloneWork(work),
      };
    });
    return this.unwrapLocked(locked, () => ({ kind: "not_active" as const }));
  }

  async transitionToPreparing(input: {
    work_id: string;
    expected_lease_epoch: number;
    now_ms: number;
  }): Promise<SharedPreparationWorkRecord> {
    const locked = await this.withWorkIdLock(input.work_id, async () => {
      const work = this.works.get(input.work_id);
      if (!work) throw new SharedPreparationStateError("work not found");
      if (work.lease_epoch !== input.expected_lease_epoch) {
        throw new SharedPreparationFencingError("stale lease epoch for preparing transition");
      }
      // retry_wait → preparing only via wakeRetryWait → queued first.
      if (work.state !== "queued") {
        throw new SharedPreparationStateError(`cannot enter preparing from ${work.state}`);
      }
      work.state = "preparing";
      work.updated_at_unix_ms = input.now_ms;
      for (const item of this.itemsForWork(work.work_id)) {
        if (item.state === "queued") {
          item.state = "preparing";
          item.updated_at_unix_ms = input.now_ms;
        }
      }
      return cloneWork(work);
    });
    return this.unwrapLocked(locked, () => {
      throw new SharedPreparationStateError("work not found");
    });
  }

  async recordRetryableFailure(input: {
    work_id: string;
    expected_lease_epoch: number;
    next_attempt_at_unix_ms: number;
    retry_deadline_unix_ms: number;
    failure: { code: string; reason: string };
    now_ms: number;
  }): Promise<SharedPreparationWorkRecord> {
    const locked = await this.withWorkIdLock(input.work_id, async () => {
      const work = this.works.get(input.work_id);
      if (!work) throw new SharedPreparationStateError("work not found");
      if (work.lease_epoch !== input.expected_lease_epoch) {
        throw new SharedPreparationFencingError("stale lease epoch for retryable failure");
      }
      if (work.state !== "preparing") {
        throw new SharedPreparationStateError(
          `retryable failure requires preparing, got ${work.state}`,
        );
      }
      work.state = "retry_wait";
      work.attempt += 1;
      work.next_attempt_at_unix_ms = input.next_attempt_at_unix_ms;
      work.retry_deadline_unix_ms = input.retry_deadline_unix_ms;
      work.lease_until_unix_ms = undefined;
      work.failure_reason = { ...input.failure };
      work.updated_at_unix_ms = input.now_ms;
      // Invalidate child progress so finalize cannot reuse pre-retry evidence.
      for (const item of this.itemsForWork(work.work_id)) {
        if (
          item.state === "ready" ||
          item.state === "preparing" ||
          item.state === "failed" ||
          item.state === "retry_wait"
        ) {
          item.state = "queued";
          item.evidence_envelope = undefined;
          item.failure_reason = undefined;
          item.updated_at_unix_ms = input.now_ms;
        }
      }
      return cloneWork(work);
    });
    return this.unwrapLocked(locked, () => {
      throw new SharedPreparationStateError("work not found");
    });
  }

  async wakeRetryWait(input: {
    work_id: string;
    expected_attempt: number;
    now_ms: number;
  }): Promise<
    | { readonly kind: "woke"; readonly work: SharedPreparationWorkRecord }
    | { readonly kind: "stale_wake" }
  > {
    type WakeResult =
      | { readonly kind: "woke"; readonly work: SharedPreparationWorkRecord }
      | { readonly kind: "stale_wake" };
    const locked = await this.withWorkIdLock(input.work_id, async (): Promise<WakeResult> => {
      const work = this.works.get(input.work_id);
      if (!work || work.state !== "retry_wait") return { kind: "stale_wake" };
      if (work.attempt !== input.expected_attempt) {
        return { kind: "stale_wake" };
      }
      if (
        work.next_attempt_at_unix_ms === undefined ||
        input.now_ms < work.next_attempt_at_unix_ms
      ) {
        return { kind: "stale_wake" };
      }
      work.state = "queued";
      work.updated_at_unix_ms = input.now_ms;
      return { kind: "woke", work: cloneWork(work) };
    });
    return this.unwrapLocked(locked, () => ({ kind: "stale_wake" as const }));
  }

  async publishChildEvidence(input: {
    work_item_id: string;
    expected_lease_epoch: number;
    evidence: ReadinessEvidenceEnvelope;
    now_ms: number;
  }): Promise<PreparationWorkItemRecord> {
    const itemLookup = this.items.get(input.work_item_id);
    if (!itemLookup) throw new SharedPreparationStateError("work item not found");
    const locked = await this.withWorkIdLock(itemLookup.work_id, async () => {
      const item = this.items.get(input.work_item_id);
      if (!item) throw new SharedPreparationStateError("work item not found");
      if (item.lease_epoch !== input.expected_lease_epoch) {
        throw new SharedPreparationFencingError("stale lease epoch for child evidence");
      }
      if (item.state !== "preparing") {
        throw new SharedPreparationStateError(
          `child evidence requires preparing, got ${item.state}`,
        );
      }
      item.state = "ready";
      item.evidence_envelope = structuredClone(input.evidence);
      item.updated_at_unix_ms = input.now_ms;
      return cloneItem(item);
    });
    return this.unwrapLocked(locked, () => {
      throw new SharedPreparationStateError("work item not found");
    });
  }

  async finalizeReadyIfQualified(input: {
    work_id: string;
    expected_lease_epoch: number;
    readiness_evidence: ReadinessEvidenceEnvelope;
    now_ms: number;
  }): Promise<
    | { readonly kind: "ready"; readonly work: SharedPreparationWorkRecord }
    | { readonly kind: "pending_children"; readonly work: SharedPreparationWorkRecord }
  > {
    type FinalizeResult =
      | { readonly kind: "ready"; readonly work: SharedPreparationWorkRecord }
      | { readonly kind: "pending_children"; readonly work: SharedPreparationWorkRecord };
    const locked = await this.withWorkIdLock(input.work_id, async (): Promise<FinalizeResult> => {
      const work = this.works.get(input.work_id);
      if (!work) throw new SharedPreparationStateError("work not found");
      if (work.lease_epoch !== input.expected_lease_epoch) {
        throw new SharedPreparationFencingError("stale lease epoch for parent ready");
      }
      if (work.state !== "preparing") {
        throw new SharedPreparationStateError(
          `finalize ready requires preparing, got ${work.state}`,
        );
      }
      assertReadinessEvidenceQualified(input.readiness_evidence);
      const children = this.itemsForWork(work.work_id);
      if (!allChildrenReady(children)) {
        return { kind: "pending_children", work: cloneWork(work) };
      }
      work.state = "ready";
      work.readiness_evidence = structuredClone(input.readiness_evidence);
      work.lease_until_unix_ms = undefined;
      work.updated_at_unix_ms = input.now_ms;
      return { kind: "ready", work: cloneWork(work) };
    });
    return this.unwrapLocked(locked, () => {
      throw new SharedPreparationStateError("work not found");
    });
  }

  async detachSubscriber(input: {
    order_id: string;
    work_id: string;
    now_ms: number;
  }): Promise<
    | { readonly kind: "detached"; readonly work?: SharedPreparationWorkRecord }
    | { readonly kind: "not_linked" }
    | { readonly kind: "serialization_retry" }
  > {
    type DetachResult =
      | { readonly kind: "detached"; readonly work?: SharedPreparationWorkRecord }
      | { readonly kind: "not_linked" }
      | { readonly kind: "serialization_retry" };
    const work = this.works.get(input.work_id);
    if (!work) return { kind: "not_linked" };
    const locked = await this.withWorkKeyLock(work.work_key_digest, async () => {
      const key = this.linkKey(input.order_id, input.work_id);
      const link = this.links.get(key);
      if (!link || link.detached_at_unix_ms !== undefined) {
        return { kind: "not_linked" as const };
      }
      link.detached_at_unix_ms = input.now_ms;
      const current = this.works.get(input.work_id);
      if (!current) return { kind: "detached" as const };
      const remaining = this.activeLinksForWork(input.work_id);
      if (remaining.length === 0 && isActivePublicWorkState(current.state)) {
        current.state = "abandoned";
        current.updated_at_unix_ms = input.now_ms;
        current.lease_until_unix_ms = undefined;
        return { kind: "detached" as const, work: cloneWork(current) };
      }
      return { kind: "detached" as const };
    });
    if (
      locked &&
      typeof locked === "object" &&
      "kind" in locked &&
      locked.kind === "serialization_retry"
    ) {
      return { kind: "serialization_retry" };
    }
    return locked as DetachResult;
  }

  async supersedeActiveGeneration(input: {
    work_key_digest: string;
    now_ms: number;
  }): Promise<SharedPreparationWorkRecord | undefined> {
    const locked = await this.withWorkKeyLock(input.work_key_digest, async () => {
      const active = this.activeRow(input.work_key_digest);
      if (!active) return undefined;
      active.state = "superseded";
      active.updated_at_unix_ms = input.now_ms;
      active.lease_until_unix_ms = undefined;
      return cloneWork(active);
    });
    if (
      locked &&
      typeof locked === "object" &&
      "kind" in locked &&
      locked.kind === "serialization_retry"
    ) {
      return undefined;
    }
    return locked as SharedPreparationWorkRecord | undefined;
  }
}

export function countActiveRows(store: InMemorySharedPreparationStore, workKeyDigest: string): number {
  return (store as unknown as { rowsForKey(d: string): MutableWork[] }).rowsForKey(workKeyDigest)
    .filter((row) => isActivePublicWorkState(row.state)).length;
}
