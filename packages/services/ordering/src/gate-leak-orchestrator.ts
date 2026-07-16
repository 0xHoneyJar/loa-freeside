import {
  GATE_LEAK_PRESET,
  GateLeakInputs,
  ORDER_LIFECYCLE_SUBJECTS,
  type OrderFailed,
  type OrderFulfilled,
  type OrderProducing,
  type OrderRefusal,
  type OrderRouting,
  type ResolvedBuilding,
} from '@freeside/ordering-protocol';
import { projectPublicJourney, PublicJourneyProjectionSchema } from '@freeside/shadow-audit-protocol';
import { digestOf } from './digest.js';
import type { GateLeakIndexPort, GateLeakPort } from './gate-leak-ports.js';
import { isTerminal, type OrderState } from './order-state.js';
import { CapabilityUnresolvedError, type CapabilityResolver, type ResolvedEndpoint } from './resolver.js';
import type { ProcessResult } from './orchestrator.js';
import type { OrderRecord, OrderStore } from './store.js';

export interface GateLeakOrchestratorDeps {
  store: OrderStore;
  resolver: CapabilityResolver;
  gateLeak?: GateLeakPort;
  index?: GateLeakIndexPort;
  now: () => number;
}

/** Preset #3: durable subject -> index unknown -> public compute/needs-input. */
export class GateLeakOrchestrator {
  constructor(private readonly deps: GateLeakOrchestratorDeps) {}

  async process(orderId: string, initial: OrderRecord): Promise<ProcessResult> {
    let record = initial;
    if (isTerminal(record.state)) return { success: true };
    const parsed = GateLeakInputs.safeParse(record.inputs);
    if (!parsed.success) {
      return this.settleFailed(orderId, record.state, {
        code: 'invalid-inputs',
        reason: 'gate-leak inputs failed preset validation',
      });
    }
    const inputs = parsed.data;

    if (record.state === 'placed') {
      let resolved: ResolvedEndpoint[];
      try {
        resolved = [];
        for (const capability of GATE_LEAK_PRESET.capabilityNeeds) {
          resolved.push(await this.deps.resolver.resolve(capability));
        }
      } catch (error) {
        const capability = error instanceof CapabilityUnresolvedError ? error.capability : 'unknown';
        return this.settleFailed(orderId, 'placed', {
          code: 'capability-unresolved',
          reason: `a required gate-leak capability could not be resolved: ${capability}`,
        });
      }
      const resolved_buildings: ResolvedBuilding[] = resolved.map((endpoint) => ({
        capability: endpoint.capability,
        building: endpoint.building,
        endpoint: endpoint.endpoint,
        source: endpoint.source,
      }));
      const routing: OrderRouting = {
        order_id: orderId,
        recipe_id: GATE_LEAK_PRESET.id,
        resolved_buildings,
      };
      const claimed = await this.deps.store.transition(orderId, 'placed', 'routing', {
        patch: { recipe_id: GATE_LEAK_PRESET.id, resolved_buildings },
        event: { subject: ORDER_LIFECYCLE_SUBJECTS.routing, payload: routing },
      });
      record = await this.reread(orderId, claimed.ok ? claimed.record : undefined);
    }

    if (record.state === 'routing') {
      const claimed = await this.deps.store.transition(orderId, 'routing', 'producing');
      record = await this.reread(orderId, claimed.ok ? claimed.record : undefined);
    }

    if (record.state !== 'producing') return { success: true };

    if (!record.output) {
      for (const [step, recipeStep] of GATE_LEAK_PRESET.recipe.entries()) {
        const producing: OrderProducing = { order_id: orderId, step, step_label: recipeStep.label };
        await this.deps.store.appendEventOnce(
          orderId,
          { subject: ORDER_LIFECYCLE_SUBJECTS.producing, payload: producing },
          `${orderId}:gate-leak:producing:${step}`,
        );
      }
    }

    const subject = {
      chain_id: inputs.chain_id,
      contract_address: inputs.contract_address.toLowerCase(),
    };
    const workKey = digestOf({
      subject,
      product: 'gate-leak:index',
    });
    const claim = await this.deps.store.claimGateLeakWork(workKey, orderId);

    if (!this.deps.index) {
      return { success: false, retryable: true, error: new Error('gate-leak collection index port unavailable') };
    }
    const indexStatus = await this.deps.index.probe(inputs.chain_id, inputs.contract_address);
    if (indexStatus !== 'complete') {
      // Only the canonical order dispatches the expensive index work. Replays are safe because
      // the upstream natural key + Idempotency-Key make this call idempotent.
      if (claim.claim.canonical_order_id === orderId) {
        const accepted = await this.deps.index.enqueue({
          orderId,
          chainId: inputs.chain_id,
          contract: inputs.contract_address,
        });
        if (!accepted && indexStatus === 'blocked') {
          return { success: false, retryable: true, error: new Error('collection index unavailable') };
        }
      }
      const journey = projectPublicJourney({
        run_id: orderId,
        journey_token: orderId,
        subject,
        outcome: 'indexing',
      });
      await this.deps.store.patchRecord(orderId, { output: { journey } });
      return { success: true };
    }

    if (!this.deps.gateLeak) {
      return { success: false, retryable: true, error: new Error('shadow gate-leak port unavailable') };
    }
    const supplementalInput = await this.deps.store.getGateLeakInput(orderId);
    const accessStartedAt = inputs.access_started_at ?? supplementalInput?.value;
    const priorJourney = PublicJourneyProjectionSchema.safeParse(
      typeof record.output === 'object' && record.output !== null && 'journey' in record.output
        ? (record.output as { journey: unknown }).journey
        : undefined,
    );
    if (priorJourney.success && priorJourney.data.status.state === 'needs_input' && !accessStartedAt) {
      return { success: true };
    }
    let submitted: Awaited<ReturnType<GateLeakPort['submit']>>;
    try {
      submitted =
        priorJourney.success && priorJourney.data.status.state === 'needs_input' && accessStartedAt
          ? await this.deps.gateLeak.resume(
              priorJourney.data.run_id,
              accessStartedAt,
              priorJourney.data.journey_token,
            )
          : await this.deps.gateLeak.submit({
              chain: inputs.chain_id,
              contract: inputs.contract_address,
              access_started_at: accessStartedAt,
              // The public service issues this capability. The local indexing
              // projection uses orderId placeholders and must not promote them.
              journey_token:
                priorJourney.success && priorJourney.data.run_id !== orderId
                  ? priorJourney.data.journey_token
                  : undefined,
            });
    } catch (error) {
      return { success: false, retryable: true, error: error instanceof Error ? error : new Error(String(error)) };
    }

    const state = submitted.journey.status.state;
    if (
      state === 'unavailable' ||
      state === 'submitted' ||
      state === 'resolving_subject' ||
      state === 'indexing' ||
      state === 'computing'
    ) {
      await this.deps.store.patchRecord(orderId, { output: submitted });
      return { success: false, retryable: true, error: new Error(`gate-leak ${state}`) };
    }
    if (state === 'refused') {
      if (submitted.journey.status.refusal_code === 'unindexed-contract') {
        await this.deps.store.patchRecord(orderId, {
          output: {
            journey: projectPublicJourney({
              run_id: submitted.journey.run_id,
              journey_token: submitted.journey.journey_token,
              subject,
              outcome: 'indexing',
            }),
          },
        });
        return { success: false, retryable: true, error: new Error('collection index not visible to audit yet') };
      }
      return this.settleFailed(orderId, 'producing', {
        code: submitted.journey.status.refusal_code,
        reason: 'the public gate-leak computation refused this subject',
      });
    }

    if (state === 'needs_input') {
      await this.deps.store.patchRecord(orderId, { output: submitted });
      return { success: true };
    }

    if (state !== 'delivered_e1') {
      return { success: false, retryable: true, error: new Error(`gate-leak unexpected state: ${state}`) };
    }

    const output = submitted;
    const output_digest = digestOf(output);
    const fulfilled: OrderFulfilled = {
      order_id: orderId,
      result_ref: submitted.journey.run_id,
      output_digest,
    };
    await this.deps.store.transition(orderId, 'producing', 'fulfilled', {
      patch: {
        result_ref: submitted.journey.run_id,
        output,
        output_digest,
      },
      event: { subject: ORDER_LIFECYCLE_SUBJECTS.fulfilled, payload: fulfilled },
    });
    return { success: true };
  }

  private async settleFailed(
    orderId: string,
    expectedFrom: OrderState,
    refusal: OrderRefusal,
  ): Promise<ProcessResult> {
    const failed: OrderFailed = { order_id: orderId, refusal };
    await this.deps.store.transition(orderId, expectedFrom, 'failed', {
      patch: { refusal },
      event: { subject: ORDER_LIFECYCLE_SUBJECTS.failed, payload: failed },
    });
    return { success: true };
  }

  private async reread(orderId: string, won: OrderRecord | undefined): Promise<OrderRecord> {
    if (won) return won;
    const current = await this.deps.store.get(orderId);
    if (!current) throw new Error(`order vanished mid-flight: ${orderId}`);
    return current;
  }
}
