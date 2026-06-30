import {
  ORDER_LIFECYCLE_SUBJECTS,
  resolvePreset,
  AccessRiskAuditInputs,
  type OrderRouting,
  type OrderProducing,
  type OrderFulfilled,
  type OrderFailed,
  type OrderRefusal,
  type ResolvedBuilding,
} from '@freeside/ordering-protocol';
import type { Cta } from '@freeside/shadow-audit-protocol';
import type { AuditServiceResult } from '@freeside/shadow-audit-service';
import { isTerminal, type OrderState } from './order-state.js';
import type { OrderStore, OrderRecord } from './store.js';
import { type CapabilityResolver, type ResolvedEndpoint, CapabilityUnresolvedError } from './resolver.js';
import { type AuditPort, type OperatedCommunityRegistry, buildAuditRequest, sanitizeRefusal } from './audit-acl.js';
import { digestOf } from './digest.js';
import type { PrivateOpsPublisher } from './private-ops.js';

/**
 * The thin orchestrator (SDD §6) — one consumer, no distributed saga.
 *
 * `process(order_id)` drives a `placed` order toward a terminal state, emitting lifecycle
 * events into the durable outbox as it goes (the publisher drains them separately — H-4, no
 * dual-write). It is idempotent + resumable under at-least-once delivery:
 *  - a redelivery of an already-terminal order acks immediately (H-3 dedupe);
 *  - a redelivery of a mid-flight order (a prior delivery died past its ack_wait) RESUMES from
 *    the current state. `runAudit` is pure (it persists nothing), so re-running it is safe; the
 *    SETTLE (terminal transition + result persist) is exactly-once via the store's CAS.
 *
 * `ProcessResult` is structurally identical to apps/worker's `BaseNatsConsumer.ProcessResult`,
 * so the deploy-time consumer shell is a one-line `processMessage` → `process()` delegation.
 */
export interface ProcessResult {
  success: boolean;
  retryable?: boolean;
  error?: Error;
}

export interface OrchestratorDeps {
  store: OrderStore;
  resolver: CapabilityResolver;
  audit: AuditPort;
  communities: OperatedCommunityRegistry;
  cta: Cta;
  /** Injected clock, unix MILLIseconds (matches BaseNatsConsumer's `now`). */
  now: () => number;
  /** Optional private ops channel (SDD §13 M-8): on a refusal, the FULL cause is emitted here while
   *  the public `failed.v1` stays sanitized. Unset → only the sanitized public event is emitted. */
  opsChannel?: PrivateOpsPublisher;
}

export class OrderOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async process(orderId: string): Promise<ProcessResult> {
    let record = await this.deps.store.get(orderId);
    if (!record) {
      // `placed` not yet visible (intake persists before publishing, so this is rare) — let it retry.
      return { success: false, retryable: true, error: new Error(`order not persisted: ${orderId}`) };
    }
    if (isTerminal(record.state)) return { success: true }; // H-3 dedupe: already settled

    const preset = resolvePreset(record.product);
    const parsedInputs = AccessRiskAuditInputs.safeParse(record.inputs);
    if (!parsedInputs.success) {
      return this.settleFailed(orderId, record.state, {
        code: 'invalid-inputs',
        reason: 'order inputs failed preset validation',
      });
    }
    const inputs = parsedInputs.data;

    // PHASE 1 — placed → routing: resolve capabilities (fail-closed), claim the order.
    if (record.state === 'placed') {
      let resolved: ResolvedEndpoint[];
      try {
        resolved = [];
        for (const cap of preset.capabilityNeeds) {
          resolved.push(await this.deps.resolver.resolve(cap));
        }
      } catch (e) {
        const cap = e instanceof CapabilityUnresolvedError ? e.capability : 'unknown';
        return this.settleFailed(orderId, 'placed', {
          code: 'capability-unresolved',
          reason: `a required capability could not be resolved: ${cap}`,
        });
      }
      const resolved_buildings: ResolvedBuilding[] = resolved.map((r) => ({
        capability: r.capability,
        building: r.building,
        endpoint: r.endpoint,
        source: r.source,
      }));
      const routing: OrderRouting = { order_id: orderId, recipe_id: preset.id, resolved_buildings };
      const claim = await this.deps.store.transition(orderId, 'placed', 'routing', {
        patch: { recipe_id: preset.id, resolved_buildings },
        event: { subject: ORDER_LIFECYCLE_SUBJECTS.routing, payload: routing },
      });
      record = await this.reread(orderId, claim.ok ? claim.record : undefined);
      if (isTerminal(record.state)) return { success: true };
    }

    // PHASE 2 — routing → producing.
    if (record.state === 'routing') {
      const claim = await this.deps.store.transition(orderId, 'routing', 'producing');
      record = await this.reread(orderId, claim.ok ? claim.record : undefined);
      if (isTerminal(record.state)) return { success: true };
    }

    // PHASE 3 — producing → fulfilled | failed: ACL → audit → settle.
    if (record.state === 'producing') {
      const community = this.deps.communities(inputs.contract);
      if (!community) {
        return this.settleFailed(orderId, 'producing', {
          code: 'unknown-community',
          reason: `no operated community is registered for contract ${inputs.contract}`,
        });
      }
      const acl = buildAuditRequest(inputs, {
        community,
        cta: this.deps.cta,
        nowUnixSeconds: Math.floor(this.deps.now() / 1000),
        includeRecords: false,
      });
      if (!acl.ok) {
        return this.settleFailed(orderId, 'producing', { code: 'invalid-order', reason: acl.reason });
      }

      // producing.v1, one per recipe step (0..n). At-least-once; consumers dedupe by (order_id, step).
      let step = 0;
      for (const rstep of preset.recipe) {
        const producing: OrderProducing = { order_id: orderId, step, step_label: rstep.label };
        await this.deps.store.appendEvent(orderId, {
          subject: ORDER_LIFECYCLE_SUBJECTS.producing,
          payload: producing,
        });
        step++;
      }

      let result: AuditServiceResult;
      try {
        result = await this.deps.audit.invoke(acl.req);
      } catch (e) {
        // Transient audit/infra error → NAK; redelivery resumes from `producing` and re-runs (pure).
        return { success: false, retryable: true, error: e instanceof Error ? e : new Error(String(e)) };
      }

      if (result.ok) {
        const output = result.output;
        const output_digest = digestOf(output);
        const fulfilled: OrderFulfilled = { order_id: orderId, result_ref: orderId, output_digest };
        await this.deps.store.transition(orderId, 'producing', 'fulfilled', {
          patch: { result_ref: orderId, output, output_digest },
          event: { subject: ORDER_LIFECYCLE_SUBJECTS.fulfilled, payload: fulfilled },
        });
        return { success: true };
      }

      // A retryable refusal (upstream-exhausted / rate-limited) is NOT a terminal failure — NAK.
      if (result.refusal.retryable) {
        return {
          success: false,
          retryable: true,
          error: new Error(`audit refused (retryable): ${result.refusal.code}`),
        };
      }
      // M-8: sanitized public failed.v1 + FULL raw cause to the private ops channel.
      return this.settleFailed(orderId, 'producing', sanitizeRefusal(result.refusal), {
        code: result.refusal.code,
        reason: result.refusal.reason,
        retryable: result.refusal.retryable,
      });
    }

    return { success: true };
  }

  /**
   * Settle to `failed` (CAS from `expectedFrom`) with a SANITIZED public refusal. Idempotent ack.
   * M-8: when an ops channel is wired, the FULL cause (`fullCause`, else the sanitized refusal) is
   * emitted privately BEFORE the public event — so diagnosis has the raw cause, the public topic doesn't.
   */
  private async settleFailed(
    orderId: string,
    expectedFrom: OrderState,
    refusal: OrderRefusal,
    fullCause?: Record<string, unknown>,
  ): Promise<ProcessResult> {
    if (this.deps.opsChannel) {
      await this.deps.opsChannel.emit({
        order_id: orderId,
        correlation_id: orderId,
        cause: fullCause ?? { code: refusal.code, reason: refusal.reason },
      });
    }
    const failed: OrderFailed = { order_id: orderId, refusal };
    await this.deps.store.transition(orderId, expectedFrom, 'failed', {
      patch: { refusal },
      event: { subject: ORDER_LIFECYCLE_SUBJECTS.failed, payload: failed },
    });
    return { success: true };
  }

  /** Use the winning transition's record, else re-read the current state (a concurrent winner advanced it). */
  private async reread(orderId: string, won: OrderRecord | undefined): Promise<OrderRecord> {
    if (won) return won;
    const current = await this.deps.store.get(orderId);
    if (!current) throw new Error(`order vanished mid-flight: ${orderId}`);
    return current;
  }
}
