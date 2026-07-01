import {
  ORDER_LIFECYCLE_SUBJECTS,
  resolvePreset,
  CommunityOnboardingInputs,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
  type CommunityOnboardingIngredients,
  type CommunityOnboardingOutput,
  type IngredientStatus,
  type OrderProducing,
  type OrderFulfilled,
  type OrderFailed,
  type OrderRefusal,
  type OrderRouting,
  type ResolvedBuilding,
} from '@freeside/ordering-protocol';
import { isTerminal, type OrderState } from './order-state.js';
import type { OrderStore, OrderRecord } from './store.js';
import { type CapabilityResolver, type ResolvedEndpoint, CapabilityUnresolvedError } from './resolver.js';
import type { PrivateOpsPublisher } from './private-ops.js';
import type { ProcessResult } from './orchestrator.js';
import type { TriagePorts } from './triage-ports.js';
import type { IngredientEnqueueService } from './ingredient-enqueue.js';
import { fireEnqueue } from './ingredient-enqueue.js';
import type { OperatorAuditEntry } from './kitchen-types.js';

export interface CommunityOnboardingOrchestratorDeps {
  store: OrderStore;
  resolver: CapabilityResolver;
  triage: TriagePorts;
  now: () => number;
  opsChannel?: PrivateOpsPublisher;
  enqueue?: IngredientEnqueueService;
}

type IngredientKey = keyof CommunityOnboardingIngredients;

const REQUIRED_INGREDIENTS: IngredientKey[] = ['sonar', 'score', 'worlds_manifest'];

export function canFulfillCommunityOnboarding(
  ingredients: CommunityOnboardingIngredients,
  fulfillment?: CommunityOnboardingOutput,
): boolean {
  if (!fulfillment?.world_slug) return false;
  for (const key of REQUIRED_INGREDIENTS) {
    if (ingredients[key] !== 'complete') return false;
  }
  return ingredients.shadow_preview === 'complete' || ingredients.shadow_preview === 'optional';
}

export function mergeProbedIngredients(
  existing: CommunityOnboardingIngredients | undefined,
  probed: CommunityOnboardingIngredients,
): CommunityOnboardingIngredients {
  const base = existing ?? INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS;
  const merged = { ...base };
  for (const key of Object.keys(probed) as IngredientKey[]) {
    const next = probed[key];
    const prev = base[key];
    if (prev === 'complete' || prev === 'optional') continue;
    if (prev === 'blocked' && next === 'pending') continue;
    merged[key] = next;
  }
  return merged;
}

/** Preset #2 triage orchestrator (SDD §3.2.3). */
export class CommunityOnboardingOrchestrator {
  constructor(private readonly deps: CommunityOnboardingOrchestratorDeps) {}

  async process(orderId: string, record: OrderRecord): Promise<ProcessResult> {
    if (isTerminal(record.state)) return { success: true };

    const preset = resolvePreset('community-onboarding');
    const parsedInputs = CommunityOnboardingInputs.safeParse(record.inputs);
    if (!parsedInputs.success) {
      return this.settleFailed(orderId, record.state, {
        code: 'invalid-inputs',
        reason: 'order inputs failed preset validation',
      });
    }
    const inputs = parsedInputs.data;

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

      const probed = await this.probeIngredients(inputs.chain_id, inputs.contract_address);
      const ingredients = mergeProbedIngredients(record.ingredients, probed.ingredients);
      let fulfillment = record.fulfillment;
      if (probed.world_slug) {
        fulfillment = this.buildFulfillment(inputs, ingredients, probed.world_slug);
      }

      const resolved_buildings: ResolvedBuilding[] = resolved.map((r) => ({
        capability: r.capability,
        building: r.building,
        endpoint: r.endpoint,
        source: r.source,
      }));
      const routing: OrderRouting = { order_id: orderId, recipe_id: preset.id, resolved_buildings };
      const claim = await this.deps.store.transition(orderId, 'placed', 'routing', {
        patch: { recipe_id: preset.id, resolved_buildings, ingredients, ...(fulfillment ? { fulfillment } : {}) },
        event: { subject: ORDER_LIFECYCLE_SUBJECTS.routing, payload: routing },
      });
      record = await this.reread(orderId, claim.ok ? claim.record : undefined);
      if (isTerminal(record.state)) return { success: true };
    }

    if (record.state === 'routing') {
      const claim = await this.deps.store.transition(orderId, 'routing', 'producing');
      record = await this.reread(orderId, claim.ok ? claim.record : undefined);
      if (isTerminal(record.state)) return { success: true };

      let step = 0;
      for (const rstep of preset.recipe) {
        const producing: OrderProducing = { order_id: orderId, step, step_label: rstep.label };
        await this.deps.store.appendEvent(orderId, {
          subject: ORDER_LIFECYCLE_SUBJECTS.producing,
          payload: producing,
        });
        step++;
      }

      fireEnqueue(orderId, this.deps.enqueue);
    }

    if (record.state === 'producing') {
      const parsedInputs = CommunityOnboardingInputs.safeParse(record.inputs);
      if (parsedInputs.success) {
        const inputs = parsedInputs.data;
        const probed = await this.probeIngredients(inputs.chain_id, inputs.contract_address);
        const merged = mergeProbedIngredients(record.ingredients, probed.ingredients);

        let fulfillment = record.fulfillment;
        if (probed.world_slug) {
          fulfillment = this.buildFulfillment(inputs, merged, probed.world_slug);
        }

        const ingredientsChanged = JSON.stringify(merged) !== JSON.stringify(record.ingredients);
        const fulfillmentChanged =
          fulfillment?.world_slug !== record.fulfillment?.world_slug ||
          fulfillment?.contact_email !== record.fulfillment?.contact_email;
        if (ingredientsChanged || fulfillmentChanged) {
          record = await this.deps.store.patchRecord(orderId, { ingredients: merged, fulfillment });
        }

        fireEnqueue(orderId, this.deps.enqueue);
      }

      const ingredients = record.ingredients ?? INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS;
      if (canFulfillCommunityOnboarding(ingredients, record.fulfillment) && record.fulfillment) {
        const fulfilled: OrderFulfilled = {
          order_id: orderId,
          result_ref: orderId,
          output_digest: record.fulfillment.world_slug,
        };
        await this.deps.store.transition(orderId, 'producing', 'fulfilled', {
          patch: { fulfillment: record.fulfillment, result_ref: orderId },
          event: { subject: ORDER_LIFECYCLE_SUBJECTS.fulfilled, payload: fulfilled },
        });
      }
    }

    return { success: true };
  }

  /** Operator MVP: patch one ingredient and attempt fulfill (SDD §3.2.4). */
  async advanceIngredient(
    orderId: string,
    ingredient: IngredientKey,
    status: IngredientStatus,
    worldSlug?: string,
  ): Promise<{ ok: boolean; record?: OrderRecord; error?: string }> {
    const record = await this.deps.store.get(orderId);
    if (!record) return { ok: false, error: 'order not found' };
    if (record.product !== 'community-onboarding') return { ok: false, error: 'not a community-onboarding order' };
    if (isTerminal(record.state)) return { ok: false, error: 'order already terminal' };

    const ingredients: CommunityOnboardingIngredients = {
      ...(record.ingredients ?? INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS),
      [ingredient]: status,
    };

    if (
      ingredients.sonar === 'complete' &&
      ingredients.score === 'complete' &&
      ingredients.worlds_manifest === 'complete' &&
      ingredients.shadow_preview === 'blocked'
    ) {
      ingredients.shadow_preview = 'pending';
    }

    const parsedInputs = CommunityOnboardingInputs.safeParse(record.inputs);
    if (!parsedInputs.success) return { ok: false, error: 'invalid order inputs' };

    let fulfillment = record.fulfillment;
    if (worldSlug) {
      fulfillment = this.buildFulfillment(parsedInputs.data, ingredients, worldSlug);
    }

    const auditEntry: OperatorAuditEntry = {
      event: 'operator.advance',
      ingredient,
      status,
      world_slug: worldSlug,
      at_unix: Math.floor(this.deps.now() / 1000),
    };
    const operator_audit = [...(record.operator_audit ?? []), auditEntry];

    const updated = await this.deps.store.patchRecord(orderId, { ingredients, fulfillment, operator_audit });

    if (updated.state === 'placed') {
      await this.process(orderId, updated);
      return { ok: true, record: await this.deps.store.get(orderId) };
    }

    if (canFulfillCommunityOnboarding(ingredients, fulfillment)) {
      await this.process(orderId, updated);
      return { ok: true, record: await this.deps.store.get(orderId) };
    }

    return { ok: true, record: updated };
  }

  private buildFulfillment(
    inputs: CommunityOnboardingInputs,
    _ingredients: CommunityOnboardingIngredients,
    worldSlug: string,
  ): CommunityOnboardingOutput {
    return {
      world_slug: worldSlug,
      contact_email: inputs.contact_email,
      chain_id: inputs.chain_id,
      contract_address: inputs.contract_address,
      community_name: inputs.community_name,
    };
  }

  private async probeIngredients(
    chainId: string,
    contract: string,
  ): Promise<{ ingredients: CommunityOnboardingIngredients; world_slug?: string }> {
    const worldsDetail = this.deps.triage.worlds.probeDetail
      ? await this.deps.triage.worlds.probeDetail(chainId, contract)
      : { status: await this.deps.triage.worlds.probe(chainId, contract) };

    const [sonar, score, discord_observer, shadow_preview] = await Promise.all([
      this.deps.triage.sonar.probe(chainId, contract),
      this.deps.triage.score.probe(chainId, contract),
      this.deps.triage.discord?.probe(chainId, contract) ?? Promise.resolve('optional' as const),
      this.deps.triage.shadow.probe(chainId, contract),
    ]);

    return {
      ingredients: {
        sonar,
        score,
        worlds_manifest: worldsDetail.status,
        discord_observer,
        shadow_preview,
      },
      world_slug: worldsDetail.world_slug,
    };
  }

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

  private async reread(orderId: string, won: OrderRecord | undefined): Promise<OrderRecord> {
    if (won) return won;
    const current = await this.deps.store.get(orderId);
    if (!current) throw new Error(`order vanished mid-flight: ${orderId}`);
    return current;
  }
}
