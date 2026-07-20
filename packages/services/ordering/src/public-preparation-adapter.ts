/**
 * CR-204A — Public Ordering-to-Sonar preparation adapter.
 *
 * Worker leases shared preparation work, dispatches idempotent Sonar child jobs,
 * reconciles lost responses, aggregates evidence, and fans outcomes to subscribers.
 * T1 public-chain fixtures only — no restricted Discord/identity paths.
 */

import { ORDER_LIFECYCLE_SUBJECTS, type OrderFailed } from "@freeside/ordering-protocol";
import type { IngredientJob } from "./kitchen-types.js";
import { ingredientJobIdempotencyKey } from "./kitchen-types.js";
import type { AdmissionCapacityStore } from "./admission-capacity-store.js";
import { COLLECTION_PREP_POOL_CAPABILITY } from "./public-preparation-constants.js";
import {
  PUBLIC_PREP_MAX_ATTEMPTS,
  PUBLIC_PREP_RETRY_DEADLINE_MS,
  PUBLIC_PREP_WORKER_LEASE_MS,
  publicPrepRetryAtMs,
} from "./public-preparation-constants.js";
import { sonarCommandInboxKey } from "./public-preparation-dispatch-key.js";
import type { PublicPrepDispatchStore } from "./public-preparation-dispatch-store.js";
import type { PublicPreparationSonarPort } from "./public-preparation-sonar-port.js";
import {
  SharedPreparationFencingError,
  type SharedPreparationStore,
} from "./shared-preparation-store.js";
import type {
  PreparationWorkItemRecord,
  ReadinessEvidenceEnvelope,
  SharedPreparationWorkRecord,
} from "./shared-preparation-types.js";
import { aggregateReadinessEvidence } from "./public-preparation-evidence.js";
import type { OrderPatch, OrderStore } from "./store.js";
import type { PrivateOpsPublisher } from "./private-ops.js";

export interface PublicPreparationAdapterDeps {
  readonly preparationStore: SharedPreparationStore;
  readonly dispatchStore: PublicPrepDispatchStore;
  readonly sonar: PublicPreparationSonarPort;
  readonly orderStore: OrderStore;
  readonly capacityStore?: AdmissionCapacityStore;
  readonly opsChannel?: PrivateOpsPublisher;
  readonly now: () => number;
  readonly workerId?: string;
  /** Test hook — when set, builds evidence from deployment ids instead of fixture helper. */
  readonly buildEvidence?: (
    work: SharedPreparationWorkRecord,
    items: readonly PreparationWorkItemRecord[],
  ) => ReadinessEvidenceEnvelope;
}

export type PublicPrepProcessResult =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "advanced"; readonly work_id: string }
  | { readonly kind: "retry_scheduled"; readonly work_id: string }
  | { readonly kind: "terminal"; readonly work_id: string; readonly code: string };

function prepIngredientJobs(
  orderId: string,
  work: SharedPreparationWorkRecord,
  items: readonly PreparationWorkItemRecord[],
): IngredientJob[] {
  return items.map((item) => ({
    ingredient: "sonar" as const,
    kind: "http_enqueue" as const,
    external_ref: item.external_job_ref ?? item.work_item_id,
    // Distinct per child — multi-deployment must not collide on orderId:sonar.
    idempotency_key: `${ingredientJobIdempotencyKey(orderId, "sonar")}:${item.work_item_id}`,
    enqueued_at_unix: Math.floor(work.updated_at_unix_ms / 1000),
  }));
}

function prepFulfillmentPatch(
  workId: string,
  phase: string,
  extra?: Record<string, unknown>,
): OrderPatch {
  return {
    fulfillment: {
      world_slug: workId,
      contact_email: "prep@fixture.local",
      chain_id: "fixture",
      contract_address: workId,
      ...extra,
      phase,
    } as OrderPatch["fulfillment"],
  };
}

export class PublicPreparationAdapter {
  constructor(private readonly deps: PublicPreparationAdapterDeps) {}

  async tick(): Promise<void> {
    const now = this.deps.now();
    for (const work of await this.deps.preparationStore.listRetryWaitDue({ now_ms: now })) {
      await this.deps.preparationStore.wakeRetryWait({
        work_id: work.work_id,
        expected_attempt: work.attempt,
        now_ms: now,
      });
    }
    await this.reconcileLostDispatches(now);
    for (const work of await this.deps.preparationStore.listLeasableWork()) {
      try {
        await this.processWork(work.work_id);
      } catch (err) {
        if (err instanceof SharedPreparationFencingError) continue;
        throw err;
      }
    }
  }

  async processWork(workId: string): Promise<PublicPrepProcessResult> {
    const now = this.deps.now();
    const workBefore = await this.deps.preparationStore.getWork(workId);
    if (!workBefore) return { kind: "idle" };

    if (workBefore.state === "ready") {
      await this.advanceLinkedOrders(workBefore);
      return { kind: "advanced", work_id: workId };
    }
    if (workBefore.state === "failed") {
      await this.failLinkedOrders(workBefore);
      return { kind: "terminal", work_id: workId, code: workBefore.failure_reason?.code ?? "preparation_failed" };
    }

    const lease = await this.deps.preparationStore.acquireLease({
      work_id: workId,
      worker_id: this.deps.workerId ?? "public-prep-worker",
      lease_duration_ms: PUBLIC_PREP_WORKER_LEASE_MS,
      now_ms: now,
    });
    if (lease.kind === "busy" || lease.kind === "not_active") {
      return { kind: lease.kind === "busy" ? "busy" : "idle" };
    }

    let work = lease.work;
    if (work.state === "queued") {
      work = await this.deps.preparationStore.transitionToPreparing({
        work_id: workId,
        expected_lease_epoch: work.lease_epoch,
        now_ms: now,
      });
    }

    let activeLease:
      | { reservation_id: string; expected_version: number }
      | undefined;
    if (this.deps.capacityStore) {
      const links = await this.deps.preparationStore.listActiveLinks(workId);
      const firstOrder = links[0]?.order_id;
      if (firstOrder) {
        const acquired = await this.deps.capacityStore.acquireActiveExecutionLease({
          order_id: firstOrder,
          pool_scope: {
            network_ref: work.finality_policy_version.split(":")[0] ?? "public",
            capability: COLLECTION_PREP_POOL_CAPABILITY,
          },
          now_ms: now,
        });
        if (acquired.kind === "acquired") {
          activeLease = {
            reservation_id: acquired.reservation.reservation_id,
            expected_version: acquired.reservation.reservation_version,
          };
        }
      }
    }

    const items = await this.deps.preparationStore.listWorkItems(workId);
    for (const item of items) {
      if (item.state === "ready") continue;
      const dispatched = await this.dispatchChildIfNeeded(work, item);
      if (!dispatched.ok && dispatched.retryable) {
        return this.scheduleRetry(work, {
          code: dispatched.error_code ?? "dependency_unavailable",
          reason: "Sonar dispatch or probe unavailable",
        });
      }
      if (!dispatched.ok && !dispatched.retryable) {
        return this.terminalFailure(work, {
          code: dispatched.error_code ?? "preparation_failed",
          reason: "Sonar rejected preparation dispatch",
        });
      }
      const current = await this.deps.preparationStore.listWorkItems(workId);
      const refreshed = current.find((row) => row.work_item_id === item.work_item_id);
      if (!refreshed?.external_job_ref) continue;
      const probed = await this.deps.sonar.probeChildJob(refreshed.external_job_ref);
      if (probed.status === "indexed") {
        const evidence =
          this.deps.buildEvidence?.(work, items) ??
          aggregateReadinessEvidence(work, [item.deployment_id]);
        await this.deps.preparationStore.publishChildEvidence({
          work_item_id: item.work_item_id,
          expected_lease_epoch: work.lease_epoch,
          evidence,
          now_ms: this.deps.now(),
        });
      } else if (probed.status === "failed" && !probed.retryable) {
        return this.terminalFailure(work, {
          code: probed.error_code ?? "preparation_failed",
          reason: "Sonar child job failed terminally",
        });
      } else if (probed.status === "failed" && probed.retryable) {
        return this.scheduleRetry(work, {
          code: probed.error_code ?? "dependency_unavailable",
          reason: "Sonar child job retryable failure",
        });
      }
    }

    const afterItems = await this.deps.preparationStore.listWorkItems(workId);
    const allReady = afterItems.length > 0 && afterItems.every((item) => item.state === "ready");
    if (!allReady) {
      await this.syncOrderPrepProjection(workId, work, afterItems);
      return { kind: "idle" };
    }

    const aggregateEvidence =
      this.deps.buildEvidence?.(work, afterItems) ??
      aggregateReadinessEvidence(
        work,
        afterItems.map((item) => item.deployment_id),
      );
    const finalized = await this.deps.preparationStore.finalizeReadyIfQualified({
      work_id: workId,
      expected_lease_epoch: work.lease_epoch,
      readiness_evidence: aggregateEvidence,
      now_ms: this.deps.now(),
    });
    if (finalized.kind === "ready") {
      await this.advanceLinkedOrders(finalized.work);
      await this.releaseActiveExecutionLease(activeLease);
      return { kind: "advanced", work_id: workId };
    }
    await this.syncOrderPrepProjection(workId, work, afterItems);
    return { kind: "idle" };
  }

  private async releaseActiveExecutionLease(
    lease: { reservation_id: string; expected_version: number } | undefined,
  ): Promise<void> {
    if (!lease || !this.deps.capacityStore) return;
    await this.deps.capacityStore.releaseReservation({
      reservation_id: lease.reservation_id,
      expected_version: lease.expected_version,
      reason: "prep_ready",
      now_ms: this.deps.now(),
    });
  }

  async reconcileLostDispatches(nowMs: number): Promise<void> {
    const pending = await this.deps.dispatchStore.listPendingReconciliation(nowMs);
    for (const row of pending) {
      const existing = await this.deps.dispatchStore.get(row.command_inbox_key);
      if (!existing) continue;
      const work = await this.deps.preparationStore.getWork(row.work_id);
      if (!work) continue;
      const items = await this.deps.preparationStore.listWorkItems(row.work_id);
      const item = items.find((i) => i.work_item_id === row.work_item_id);
      if (!item || item.external_job_ref) continue;
      const replay = await this.deps.sonar.dispatchChildJob({
        command_inbox_key: row.command_inbox_key,
        deployment_id: item.deployment_id,
        capability: item.capability,
        adapter_version: item.adapter_version,
        generation: work.generation,
        lease_epoch: work.lease_epoch,
        kitchen_deployment: item.kitchen_target,
      });
      if (replay.ok && replay.external_job_ref) {
        await this.deps.dispatchStore.recordAck({
          command_inbox_key: row.command_inbox_key,
          external_job_ref: replay.external_job_ref,
          now_ms: nowMs,
        });
        await this.deps.preparationStore.recordChildJobRef({
          work_item_id: item.work_item_id,
          expected_lease_epoch: work.lease_epoch,
          external_job_ref: replay.external_job_ref,
          now_ms: nowMs,
        });
      }
    }
  }

  private async dispatchChildIfNeeded(
    work: SharedPreparationWorkRecord,
    item: PreparationWorkItemRecord,
  ): Promise<{ ok: boolean; retryable?: boolean; error_code?: string }> {
    if (item.external_job_ref) {
      return { ok: true };
    }
    const inboxKey = sonarCommandInboxKey({
      generation: work.generation,
      deployment_id: item.deployment_id,
      capability: item.capability,
      adapter_version: item.adapter_version,
    });
    const now = this.deps.now();
    await this.deps.dispatchStore.recordIntent({
      command_inbox_key: inboxKey,
      work_item_id: item.work_item_id,
      work_id: work.work_id,
      lease_epoch: work.lease_epoch,
      now_ms: now,
    });
    const result = await this.deps.sonar.dispatchChildJob({
      command_inbox_key: inboxKey,
      deployment_id: item.deployment_id,
      capability: item.capability,
      adapter_version: item.adapter_version,
      generation: work.generation,
      lease_epoch: work.lease_epoch,
      kitchen_deployment: item.kitchen_target,
    });
    if (result.ok && result.external_job_ref) {
      await this.deps.dispatchStore.recordAck({
        command_inbox_key: inboxKey,
        external_job_ref: result.external_job_ref,
        now_ms: now,
      });
      await this.deps.preparationStore.recordChildJobRef({
        work_item_id: item.work_item_id,
        expected_lease_epoch: work.lease_epoch,
        external_job_ref: result.external_job_ref,
        now_ms: now,
      });
      return { ok: true };
    }
    if (!result.ok && result.external_job_ref === undefined) {
      await this.deps.dispatchStore.markLostResponse(inboxKey);
    }
    return {
      ok: result.ok,
      retryable: result.retryable,
      error_code: result.error_code,
    };
  }

  private async scheduleRetry(
    work: SharedPreparationWorkRecord,
    failure: { code: string; reason: string },
  ): Promise<PublicPrepProcessResult> {
    const now = this.deps.now();
    const nextAttempt = publicPrepRetryAtMs(work.attempt + 1, now);
    const deadline = work.retry_deadline_unix_ms ?? now + PUBLIC_PREP_RETRY_DEADLINE_MS;
    if (work.attempt + 1 >= PUBLIC_PREP_MAX_ATTEMPTS || nextAttempt > deadline) {
      return this.terminalFailure(work, {
        code: "retry_exhausted",
        reason: failure.reason,
      });
    }
    await this.deps.preparationStore.recordRetryableFailure({
      work_id: work.work_id,
      expected_lease_epoch: work.lease_epoch,
      next_attempt_at_unix_ms: nextAttempt,
      retry_deadline_unix_ms: deadline,
      failure,
      now_ms: now,
    });
    await this.syncSubscriberAttention(work, failure.code, false);
    return { kind: "retry_scheduled", work_id: work.work_id };
  }

  private async terminalFailure(
    work: SharedPreparationWorkRecord,
    failure: { code: string; reason: string },
  ): Promise<PublicPrepProcessResult> {
    const failed = await this.deps.preparationStore.recordTerminalFailure({
      work_id: work.work_id,
      expected_lease_epoch: work.lease_epoch,
      failure,
      now_ms: this.deps.now(),
    });
    await this.failLinkedOrders(failed);
    return { kind: "terminal", work_id: work.work_id, code: failure.code };
  }

  private async syncOrderPrepProjection(
    workId: string,
    work: SharedPreparationWorkRecord,
    items: readonly PreparationWorkItemRecord[],
  ): Promise<void> {
    const links = await this.deps.preparationStore.listActiveLinks(workId);
    for (const link of links) {
      const jobs = prepIngredientJobs(link.order_id, work, items);
      await this.deps.orderStore.patchRecord(link.order_id, {
        ingredient_jobs: jobs,
        ...prepFulfillmentPatch(workId, "preparing_collection_data"),
      });
    }
  }

  private async advanceLinkedOrders(work: SharedPreparationWorkRecord): Promise<void> {
    const items = await this.deps.preparationStore.listWorkItems(work.work_id);
    const links = await this.deps.preparationStore.listActiveLinks(work.work_id);
    for (const link of links) {
      const jobs = prepIngredientJobs(link.order_id, work, items);
      await this.deps.orderStore.patchRecord(link.order_id, {
        ingredient_jobs: jobs,
        ...prepFulfillmentPatch(work.work_id, "ownership_evidence_ready", {
          prep_generation: work.generation,
        }),
      });
    }
  }

  private async failLinkedOrders(work: SharedPreparationWorkRecord): Promise<void> {
    const code = work.failure_reason?.code ?? "preparation_failed";
    const reason = work.failure_reason?.reason ?? "shared preparation failed";
    await this.syncSubscriberAttention(work, code, true);
    const links = await this.deps.preparationStore.listActiveLinks(work.work_id);
    for (const link of links) {
      const record = await this.deps.orderStore.get(link.order_id);
      if (!record || record.state !== "producing") continue;
      if (this.deps.opsChannel) {
        await this.deps.opsChannel.emit({
          order_id: link.order_id,
          correlation_id: work.work_id,
          cause: { code, reason },
        });
      }
      const failed: OrderFailed = {
        order_id: link.order_id,
        refusal: { code, reason },
      };
      await this.deps.orderStore.transition(link.order_id, "producing", "failed", {
        patch: { refusal: failed.refusal },
        event: { subject: ORDER_LIFECYCLE_SUBJECTS.failed, payload: failed },
      });
      if (this.deps.capacityStore) {
        await this.deps.capacityStore.releaseOrderCapacity({
          order_id: link.order_id,
          reason: "terminal_failure",
          now_ms: this.deps.now(),
        });
      }
    }
  }

  private async syncSubscriberAttention(
    work: SharedPreparationWorkRecord,
    code: string,
    terminal: boolean,
  ): Promise<void> {
    const links = await this.deps.preparationStore.listActiveLinks(work.work_id);
    for (const link of links) {
      if (terminal) continue;
      await this.deps.orderStore.patchRecord(link.order_id, {
        ...prepFulfillmentPatch(work.work_id, "remediation_required", {
          action_needed_code: code,
        }),
      });
    }
  }
}
