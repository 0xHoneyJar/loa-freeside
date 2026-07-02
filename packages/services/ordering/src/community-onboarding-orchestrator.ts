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
import type { OperatorAuditEntry, OrderProbeMeta, ProbeSource } from './kitchen-types.js';

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

/** Reprobe bounds (SDD D1 / SKP-001a). Env-tunable for tests only. */
const REPROBE_COOLDOWN_MS = Number(process.env.REPROBE_COOLDOWN_MS ?? 10_000);
const REPROBE_PER_PROBE_TIMEOUT_MS = Number(process.env.REPROBE_PER_PROBE_TIMEOUT_MS ?? 10_000);
const REPROBE_FANOUT = 3;

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
  probed: Partial<CommunityOnboardingIngredients>,
): CommunityOnboardingIngredients {
  const base = existing ?? INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS;
  const merged = { ...base };
  for (const key of Object.keys(probed) as IngredientKey[]) {
    const next = probed[key];
    if (next === undefined) continue;
    const prev = base[key];
    if (prev === 'complete' || prev === 'optional') continue;
    if (prev === 'blocked' && next === 'pending') continue;
    if (prev === 'in_progress' && next === 'pending') continue;
    merged[key] = next;
  }
  return merged;
}

/** probe_meta entries for a set of raw probe results (SDD D1 — raw probe truth, pre-merge). */
export function probeMetaEntries(
  probed: Partial<CommunityOnboardingIngredients>,
  atUnix: number,
  source: ProbeSource,
): OrderProbeMeta {
  const meta: OrderProbeMeta = {};
  for (const [key, status] of Object.entries(probed)) {
    if (status === undefined) continue;
    meta[key] = { status, probed_at_unix: atUnix, source };
  }
  return meta;
}

/** Per-ingredient outcome of an on-demand reprobe (SDD D1 failure semantics). */
export interface ReprobeIngredientOutcome {
  status?: IngredientStatus;
  probed_at_unix: number;
  source: 'reprobe';
  freshness: 'fresh' | 'ambiguous';
  error_class?: 'timeout' | 'probe_error';
}

export type ReprobeResult =
  | { ok: true; record: OrderRecord; probes: Record<string, ReprobeIngredientOutcome> }
  | { ok: false; error: 'order not found' | 'not a community-onboarding order' | 'order already terminal' | 'cooldown'; retry_after_unix?: number };

/** Race a probe against a deadline. loa:shortcut: no AbortController propagation — TriagePorts
 * has no signal param, so a timed-out probe's underlying fetch may linger until its own network
 * timeout; add signal support to TriagePorts if lingering probes ever matter. */
async function probeWithTimeout<T>(
  probe: () => Promise<T>,
  timeoutMs: number,
): Promise<{ ok: true; value: T } | { ok: false; error_class: 'timeout' | 'probe_error' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      probe().then((value) => ({ ok: true as const, value })),
      new Promise<{ ok: false; error_class: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, error_class: 'timeout' }), timeoutMs);
      }),
    ]);
    return result;
  } catch {
    return { ok: false, error_class: 'probe_error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
      const probe_meta: OrderProbeMeta = {
        ...record.probe_meta,
        ...probeMetaEntries(probed.ingredients, Math.floor(this.deps.now() / 1000), 'interval'),
      };
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
        patch: { recipe_id: preset.id, resolved_buildings, ingredients, probe_meta, ...(fulfillment ? { fulfillment } : {}) },
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
          // probe_meta piggybacks on patches the merge already requires — the on-demand
          // freshness path is `reprobe()`, not the interval tick (SDD D1).
          const probe_meta: OrderProbeMeta = {
            ...record.probe_meta,
            ...probeMetaEntries(probed.ingredients, Math.floor(this.deps.now() / 1000), 'interval'),
          };
          record = await this.deps.store.patchRecord(orderId, { ingredients: merged, fulfillment, probe_meta });
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

  /** Operator MVP: patch one ingredient and attempt fulfill (SDD §3.2.4).
   *
   * Audit evidence + actor are SERVER-derived (SDD D3): `evidence` is a value copy of
   * this order's own `probe_meta[ingredient]` at advance time (`null` when never probed —
   * the HITL escape hatch, visibly ungrounded); `token_label` names the credential that
   * authenticated the request. `caller_note` is untrusted display metadata.
   */
  async advanceIngredient(
    orderId: string,
    ingredient: IngredientKey,
    status: IngredientStatus,
    worldSlug?: string,
    opts?: { tokenLabel?: string; callerNote?: string },
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

    const priorMeta = record.probe_meta?.[ingredient];
    const auditEntry: OperatorAuditEntry = {
      event: 'operator.advance',
      ingredient,
      status,
      world_slug: worldSlug,
      at_unix: Math.floor(this.deps.now() / 1000),
      token_label: opts?.tokenLabel,
      caller_note: opts?.callerNote,
      // Immutable value COPY of the server's own probe truth (never a live reference —
      // later reprobes must not mutate past audit entries).
      evidence: priorMeta ? { ...priorMeta } : null,
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

  /** Per-order last-reprobe clock (unix ms). loa:shortcut: in-memory — correct for the
   * single-instance Railway deploy; move to the store if the service ever scales out. */
  private readonly reprobeCooldown = new Map<string, number>();

  /**
   * On-demand synchronous reprobe (SDD D1, FR-4). Bounds: 10s per probe (race-timeout),
   * fan-out ≤3, 10s per-order cooldown. Worst case 2 batches × 10s = 20s — structurally
   * inside the 30s global budget. A probe failure/timeout is a RESULT (`ambiguous`),
   * never an HTTP error; probe_meta and the ingredient merge are only updated for
   * fresh successes (ambiguity never overwrites recorded truth).
   */
  async reprobe(orderId: string, ingredient?: IngredientKey): Promise<ReprobeResult> {
    const initial = await this.deps.store.get(orderId);
    if (!initial) return { ok: false, error: 'order not found' };
    if (initial.product !== 'community-onboarding') return { ok: false, error: 'not a community-onboarding order' };
    if (isTerminal(initial.state)) return { ok: false, error: 'order already terminal' };

    const nowMs = this.deps.now();
    const last = this.reprobeCooldown.get(orderId);
    if (last !== undefined && nowMs - last < REPROBE_COOLDOWN_MS) {
      return { ok: false, error: 'cooldown', retry_after_unix: Math.ceil((last + REPROBE_COOLDOWN_MS) / 1000) };
    }
    this.reprobeCooldown.set(orderId, nowMs);

    const parsedInputs = CommunityOnboardingInputs.safeParse(initial.inputs);
    if (!parsedInputs.success) return { ok: false, error: 'not a community-onboarding order' };
    const inputs = parsedInputs.data;

    const current = initial.ingredients ?? INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS;
    const targets: IngredientKey[] = ingredient
      ? [ingredient]
      : (Object.keys(current) as IngredientKey[]).filter(
          (k) => current[k] === 'pending' || current[k] === 'in_progress',
        );

    // Probe with fan-out ≤3, 10s per probe.
    const probes: Record<string, ReprobeIngredientOutcome> = {};
    const probedStatuses: Partial<CommunityOnboardingIngredients> = {};
    let worldSlug: string | undefined;
    for (let i = 0; i < targets.length; i += REPROBE_FANOUT) {
      const batch = targets.slice(i, i + REPROBE_FANOUT);
      await Promise.all(
        batch.map(async (key) => {
          const atUnix = Math.floor(this.deps.now() / 1000);
          if (key === 'worlds_manifest' && this.deps.triage.worlds.probeDetail) {
            // world_slug travels INSIDE the raced value — a timed-out probe that
            // resolves late can never contribute data (review finding #3).
            const res = await probeWithTimeout(
              () => this.deps.triage.worlds.probeDetail!(inputs.chain_id, inputs.contract_address),
              REPROBE_PER_PROBE_TIMEOUT_MS,
            );
            probes[key] = res.ok
              ? { status: res.value.status, probed_at_unix: atUnix, source: 'reprobe', freshness: 'fresh' }
              : { probed_at_unix: atUnix, source: 'reprobe', freshness: 'ambiguous', error_class: res.error_class };
            if (res.ok) {
              probedStatuses[key] = res.value.status;
              if (res.value.world_slug) worldSlug = res.value.world_slug;
            }
            return;
          }
          const port = this.probePortFor(key);
          const res = await probeWithTimeout(
            () => port(inputs.chain_id, inputs.contract_address),
            REPROBE_PER_PROBE_TIMEOUT_MS,
          );
          probes[key] = res.ok
            ? { status: res.value, probed_at_unix: atUnix, source: 'reprobe', freshness: 'fresh' }
            : { probed_at_unix: atUnix, source: 'reprobe', freshness: 'ambiguous', error_class: res.error_class };
          if (res.ok) probedStatuses[key] = res.value;
        }),
      );
    }

    // Merge against a FRESH read — probes take seconds; an advance may have landed
    // meanwhile. The monotonic merge cannot downgrade a concurrent 'complete' (IMP-003).
    const fresh = (await this.deps.store.get(orderId)) ?? initial;
    if (isTerminal(fresh.state)) return { ok: true, record: fresh, probes };
    const merged = mergeProbedIngredients(fresh.ingredients, probedStatuses);
    const probe_meta: OrderProbeMeta = {
      ...fresh.probe_meta,
      ...probeMetaEntries(probedStatuses, Math.floor(this.deps.now() / 1000), 'reprobe'),
    };
    let fulfillment = fresh.fulfillment;
    if (worldSlug && !fulfillment?.world_slug) {
      fulfillment = this.buildFulfillment(inputs, merged, worldSlug);
    }
    let record = await this.deps.store.patchRecord(orderId, { ingredients: merged, fulfillment, probe_meta });

    // Attempt fulfill via the existing CAS transition — a lost CAS means someone else
    // settled the order first; return their truth.
    if (record.state === 'producing' && canFulfillCommunityOnboarding(merged, fulfillment) && fulfillment) {
      const fulfilled: OrderFulfilled = {
        order_id: orderId,
        result_ref: orderId,
        output_digest: fulfillment.world_slug,
      };
      const claim = await this.deps.store.transition(orderId, 'producing', 'fulfilled', {
        patch: { fulfillment, result_ref: orderId },
        event: { subject: ORDER_LIFECYCLE_SUBJECTS.fulfilled, payload: fulfilled },
      });
      record = claim.record ?? (await this.deps.store.get(orderId)) ?? record;
    }

    return { ok: true, record, probes };
  }

  private probePortFor(key: IngredientKey): (chainId: string, contract: string) => Promise<IngredientStatus> {
    switch (key) {
      case 'sonar':
        return (c, a) => this.deps.triage.sonar.probe(c, a);
      case 'score':
        return (c, a) => this.deps.triage.score.probe(c, a);
      case 'worlds_manifest':
        return (c, a) => this.deps.triage.worlds.probe(c, a);
      case 'discord_observer':
        return (c, a) => this.deps.triage.discord?.probe(c, a) ?? Promise.resolve('optional' as const);
      case 'shadow_preview':
        return (c, a) => this.deps.triage.shadow.probe(c, a);
    }
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
