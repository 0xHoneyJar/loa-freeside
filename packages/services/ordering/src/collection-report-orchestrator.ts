/**
 * Collection-report lifecycle driver (CR-303 honesty).
 *
 * Intake already admits a confirmed resolution binding. This orchestrator must
 * NOT route through AccessRiskAuditInputs (that caused immediate invalid-inputs
 * failures). V1 advances placed → routing → producing and holds in preparing
 * until a real Gate Leak producer exists — no fake fulfill, no ETA theater.
 */

import {
  ORDER_LIFECYCLE_SUBJECTS,
  resolvePreset,
  type OrderRouting,
  type OrderProducing,
  type OrderFailed,
  type OrderRefusal,
  type ResolvedBuilding,
} from "@freeside/ordering-protocol";
import { isTerminal, type OrderState } from "./order-state.js";
import type { OrderStore, OrderRecord } from "./store.js";
import {
  type CapabilityResolver,
  type ResolvedEndpoint,
  CapabilityUnresolvedError,
} from "./resolver.js";
import type { PrivateOpsPublisher } from "./private-ops.js";
import type { ProcessResult } from "./orchestrator.js";
import type { PublicPreparationAdapter } from "./public-preparation-adapter.js";
import type { SharedPreparationStore } from "./shared-preparation-store.js";

export interface CollectionReportOrchestratorDeps {
  store: OrderStore;
  resolver: CapabilityResolver;
  now: () => number;
  opsChannel?: PrivateOpsPublisher;
  /** CR-204A — drive linked shared preparation work while producing. */
  preparationStore?: SharedPreparationStore;
  publicPrepAdapter?: PublicPreparationAdapter;
}

export class CollectionReportOrchestrator {
  constructor(private readonly deps: CollectionReportOrchestratorDeps) {}

  async process(orderId: string, record: OrderRecord): Promise<ProcessResult> {
    if (isTerminal(record.state)) return { success: true };
    if (record.product !== "collection-report") {
      return {
        success: false,
        retryable: false,
        error: new Error(`not a collection-report order: ${record.product}`),
      };
    }

    const preset = resolvePreset("collection-report");
    const parsedInputs = preset.inputSchema.safeParse(record.inputs);
    if (!parsedInputs.success) {
      return this.settleFailed(orderId, record.state, {
        code: "invalid-inputs",
        reason: "order inputs failed collection-report preset validation",
      });
    }

    if (record.state === "placed") {
      let resolved: ResolvedEndpoint[];
      try {
        resolved = [];
        for (const cap of preset.capabilityNeeds) {
          resolved.push(await this.deps.resolver.resolve(cap));
        }
      } catch (e) {
        const cap = e instanceof CapabilityUnresolvedError ? e.capability : "unknown";
        return this.settleFailed(orderId, "placed", {
          code: "capability-unresolved",
          reason: `a required capability could not be resolved: ${cap}`,
        });
      }

      const resolved_buildings: ResolvedBuilding[] = resolved.map((r) => ({
        capability: r.capability,
        building: r.building,
        endpoint: r.endpoint,
        source: r.source,
      }));
      const routing: OrderRouting = {
        order_id: orderId,
        recipe_id: preset.id,
        resolved_buildings,
      };
      const claim = await this.deps.store.transition(orderId, "placed", "routing", {
        patch: { recipe_id: preset.id, resolved_buildings },
        event: { subject: ORDER_LIFECYCLE_SUBJECTS.routing, payload: routing },
      });
      record = await this.reread(orderId, claim.ok ? claim.record : undefined);
      if (isTerminal(record.state)) return { success: true };
    }

    if (record.state === "routing") {
      const producing: OrderProducing = {
        order_id: orderId,
        step: 0,
        step_label: preset.recipe[0]?.label ?? "prepare collection report",
      };
      // No fulfillment patch: CommunityOnboardingOutput shape is onboarding-only.
      // Bare `producing` maps to user_status preparing_collection_data (CR-206).
      const claim = await this.deps.store.transition(orderId, "routing", "producing", {
        event: { subject: ORDER_LIFECYCLE_SUBJECTS.producing, payload: producing },
      });
      record = await this.reread(orderId, claim.ok ? claim.record : undefined);
      if (isTerminal(record.state)) return { success: true };
    }

    if (record.state === "producing") {
      if (this.deps.preparationStore && this.deps.publicPrepAdapter) {
        const linked = await this.deps.preparationStore.getActiveWorkForOrder(orderId);
        if (linked) {
          await this.deps.publicPrepAdapter.processWork(linked.work.work_id);
          record = await this.reread(orderId, undefined);
          if (isTerminal(record.state)) return { success: true };
          const phase = fulfillmentPhase(record);
          if (phase === "ownership_evidence_ready") {
            // Prep complete; Gate Leak artifact/render producer not wired yet.
            // Honest terminal — no fake fulfill / ETA theater (CR-303).
            return this.settleFailed(orderId, "producing", {
              code: "gate_leak_artifact_producer_pending",
              reason:
                "public preparation ownership evidence is ready; Gate Leak artifact producer is not deployed",
            });
          }
          if (phase === "remediation_required") {
            return this.settleFailed(orderId, "producing", {
              code: "preparation_failed",
              reason: "shared public preparation requires remediation",
            });
          }
        }
      }
      return { success: true };
    }

    return { success: true };
  }

  private async settleFailed(
    orderId: string,
    expectedFrom: OrderState,
    refusal: OrderRefusal,
  ): Promise<ProcessResult> {
    if (this.deps.opsChannel) {
      await this.deps.opsChannel.emit({
        order_id: orderId,
        correlation_id: orderId,
        cause: { code: refusal.code, reason: refusal.reason },
      });
    }
    const failed: OrderFailed = { order_id: orderId, refusal };
    await this.deps.store.transition(orderId, expectedFrom, "failed", {
      patch: { refusal },
      event: { subject: ORDER_LIFECYCLE_SUBJECTS.failed, payload: failed },
    });
    return { success: true };
  }

  private async reread(
    orderId: string,
    won: OrderRecord | undefined,
  ): Promise<OrderRecord> {
    if (won) return won;
    const current = await this.deps.store.get(orderId);
    if (!current) throw new Error(`order vanished mid-flight: ${orderId}`);
    return current;
  }
}

function fulfillmentPhase(record: OrderRecord): string {
  const fulfillment = record.fulfillment as
    | { readonly phase?: string; readonly stage?: string }
    | undefined;
  const phase = fulfillment?.phase ?? fulfillment?.stage ?? "";
  return typeof phase === "string" ? phase : "";
}
