import {
  CommunityOnboardingInputs,
  type CommunityOnboardingIngredients,
  type IngredientStatus,
} from '@freeside/ordering-protocol';

import { CommunityOnboardingOrchestrator, mergeProbedIngredients } from './community-onboarding-orchestrator.js';
import type { GitHubIssuePort } from './github-issue-port.js';
import type { DispatchResult, HttpEnqueuePayload } from './http-building-probes.js';
import { type EnqueueIngredientKey, ingredientJobIdempotencyKey } from './kitchen-types.js';
import { isTerminal, type OrderState } from './order-state.js';
import {
  ORCHESTRATOR_SUBJECTS,
  OrchestratorAdvanceSchema,
  OrchestratorDispatchSchema,
  OrchestratorEscalateSchema,
  OrchestratorProbeSchema,
  SlugDivergenceSchema,
} from './orchestrator-events.js';
import { reprobeIntervalMs } from './reprobe-worker.js';
import type { OrderStore } from './store.js';
import type { TriagePorts } from './triage-ports.js';

type IngredientKey = keyof CommunityOnboardingIngredients;

/** Every ingredient, in probe order. */
const ALL_INGREDIENTS: readonly IngredientKey[] = [
  'sonar',
  'score',
  'worlds_manifest',
  'discord_observer',
  'shadow_preview',
];

/** Dispatch order — WORLDS-FIRST so the canonical slug is sourced before score register (D-5). */
const DISPATCH_ORDER: readonly EnqueueIngredientKey[] = ['worlds_manifest', 'score', 'sonar'];

/**
 * The single decision table (SDD §4.1 / task 23.2). Ingredient status → orchestrator action:
 * `pending` (sonar 404/missing, score/worlds 404) → dispatch the idempotent write;
 * `in_progress` (sonar indexing/queued) → wait for the next tick;
 * `complete`/`optional` (indexed, lookup 200-active) → advance in-process;
 * `blocked` (sonar failed OR any unreachable/ambiguous surface) → escalate (D-2, never advance).
 */
export type IngredientAction = 'satisfied' | 'wait' | 'dispatch' | 'escalate';

export function actionForStatus(status: IngredientStatus): IngredientAction {
  switch (status) {
    case 'complete':
    case 'optional':
      return 'satisfied';
    case 'in_progress':
      return 'wait';
    case 'pending':
      return 'dispatch';
    case 'blocked':
      return 'escalate';
  }
}

/** Idempotent upstream writes. `HttpBuildingProbes` satisfies this structurally. */
export interface FulfillmentDispatchPort {
  ingestSonar(payload: HttpEnqueuePayload): Promise<DispatchResult>;
  registerScore(payload: HttpEnqueuePayload): Promise<DispatchResult>;
  manifestWorlds(payload: HttpEnqueuePayload): Promise<DispatchResult>;
}

export interface FulfillmentOrchestratorDeps {
  store: OrderStore;
  /** Ingredient status probes (HTTP or stub). Same port the intake orchestrator uses. */
  triage: TriagePorts;
  /** In-process advance path — REUSED, preserves the audit entry + shadow_preview unblock. */
  onboarding: CommunityOnboardingOrchestrator;
  /** Idempotent upstream dispatch; `null` disables the dispatch stage (probe/advance only). */
  dispatch: FulfillmentDispatchPort | null;
  /** Escalation surface; `null` (no GITHUB_TOKEN) makes the GitHub comment a no-op — the
   *  `orchestrator.escalate` EVENT still fires, so escalation is never a silent stall (D-2). */
  github: GitHubIssuePort | null;
  /** Injected clock, unix MILLIseconds (matches the intake orchestrator). */
  now: () => number;
  /** Credential label recorded on advance audit entries. */
  tokenLabel?: string;
}

/**
 * The fulfillment orchestrator (SDD §4.1, D-1). Per non-terminal community-onboarding order:
 * **probe → dispatch → wait → advance → (fulfill | escalate)**.
 *
 * Crash-safe: re-dispatch is idempotent on the upstream keys (`orderId:ingredient`), so a
 * restart mid-run never double-provisions. It owns NO new state — it drives off `orders` +
 * the outbox and emits only additive event kinds (`orchestrator.*`, `slug_divergence`).
 */
export class FulfillmentOrchestrator {
  constructor(private readonly deps: FulfillmentOrchestratorDeps) {}

  /** Per-process escalation dedup. loa:shortcut: in-memory — correct for the single-instance
   *  Railway deploy (mirrors the intake orchestrator's `reprobeCooldown`); move to the store if
   *  the worker ever scales out. A restart re-escalates once; the event carries an
   *  `idempotency_key` so a consumer can dedupe. */
  private readonly escalated = new Set<string>();

  async processOrder(orderId: string): Promise<void> {
    let record = await this.deps.store.get(orderId);
    if (!record || record.product !== 'community-onboarding' || isTerminal(record.state)) return;

    // Lifecycle: drive placed/routing → producing via the existing state machine (idempotent CAS).
    if (record.state === 'placed' || record.state === 'routing') {
      await this.deps.onboarding.process(orderId, record);
      const advanced = await this.deps.store.get(orderId);
      if (!advanced || isTerminal(advanced.state)) return;
      record = advanced;
    }
    if (record.state !== 'producing') return;

    const parsed = CommunityOnboardingInputs.safeParse(record.inputs);
    if (!parsed.success) return; // invalid inputs are the intake orchestrator's failure path
    const inputs = parsed.data;

    // PROBE ────────────────────────────────────────────────────────────────
    const probe = await this.probeAll(inputs.chain_id, inputs.contract_address);
    await this.emit(orderId, ORCHESTRATOR_SUBJECTS.probe, OrchestratorProbeSchema.parse({
      order_id: orderId,
      statuses: probe.statuses,
      world_slug: probe.worldSlug,
      at_unix: this.nowUnix(),
    }));

    // DISPATCH (worlds-first) ────────────────────────────────────────────────
    let canonicalSlug = probe.worldSlug;
    const payload = this.payloadFor(orderId, inputs);
    for (const ingredient of DISPATCH_ORDER) {
      if (probe.statuses[ingredient] !== 'pending') continue;
      const res = this.deps.dispatch ? await this.dispatchOne(ingredient, payload) : { ok: false };
      await this.emit(orderId, ORCHESTRATOR_SUBJECTS.dispatch, OrchestratorDispatchSchema.parse({
        order_id: orderId,
        ingredient,
        ok: res.ok,
        idempotency_key: ingredientJobIdempotencyKey(orderId, ingredient),
        at_unix: this.nowUnix(),
      }));
      if (ingredient === 'worlds_manifest' && res.world_slug) canonicalSlug = res.world_slug;
      if (ingredient === 'score' && res.world_slug && canonicalSlug && res.world_slug !== canonicalSlug) {
        await this.emit(orderId, ORCHESTRATOR_SUBJECTS.slug_divergence, SlugDivergenceSchema.parse({
          order_id: orderId,
          worlds_slug: canonicalSlug,
          score_slug: res.world_slug,
          at_unix: this.nowUnix(),
        }));
      }
      if (res.ok) await this.markInProgress(orderId, ingredient);
    }

    // ADVANCE satisfied ingredients ─────────────────────────────────────────
    for (const ingredient of ALL_INGREDIENTS) {
      // shadow_preview is operator-owned and GATES fulfillment (AC6; see
      // canFulfillCommunityOnboarding:44-53). The orchestrator must NEVER advance it —
      // only the operator can. Excluding it keeps the fulfillment gate in operator hands.
      if (ingredient === 'shadow_preview') continue;
      const status = probe.statuses[ingredient];
      if (actionForStatus(status) !== 'satisfied') continue;
      const current = (await this.deps.store.get(orderId))?.ingredients?.[ingredient];
      if (current === 'complete' || current === 'optional') continue; // already recorded
      // worlds probed complete but carried no canonical slug: advancing would record a
      // slug-less fulfillment that can never satisfy canFulfill — a silent stall in
      // producing. Escalate instead; never advance worlds without a slug (D-2).
      if (ingredient === 'worlds_manifest' && !canonicalSlug) {
        await this.escalate(orderId, ingredient, 'worlds returned complete without world_slug');
        continue;
      }
      const slug = ingredient === 'worlds_manifest' ? canonicalSlug : undefined;
      await this.deps.onboarding.advanceIngredient(orderId, ingredient, status, slug, {
        tokenLabel: this.deps.tokenLabel,
        callerNote: 'fulfillment-orchestrator',
      });
      await this.emit(orderId, ORCHESTRATOR_SUBJECTS.advance, OrchestratorAdvanceSchema.parse({
        order_id: orderId,
        ingredient,
        status,
        world_slug: slug,
        at_unix: this.nowUnix(),
      }));
      const after = await this.deps.store.get(orderId);
      if (after && isTerminal(after.state)) return; // fulfilled mid-advance
    }

    // ESCALATE blocked/ambiguous ingredients — NEVER a silent stall (D-2) ─────
    for (const ingredient of ALL_INGREDIENTS) {
      if (actionForStatus(probe.statuses[ingredient]) !== 'escalate') continue;
      await this.escalate(orderId, ingredient, `${ingredient} probe returned blocked/failed`);
    }
  }

  private async probeAll(
    chainId: string,
    contract: string,
  ): Promise<{ statuses: Record<IngredientKey, IngredientStatus>; worldSlug?: string }> {
    const worldsDetail = this.deps.triage.worlds.probeDetail
      ? await this.deps.triage.worlds.probeDetail(chainId, contract)
      : { status: await this.deps.triage.worlds.probe(chainId, contract), world_slug: undefined };

    const [sonar, score, discord_observer, shadow_preview] = await Promise.all([
      this.deps.triage.sonar.probe(chainId, contract),
      this.deps.triage.score.probe(chainId, contract),
      this.deps.triage.discord?.probe(chainId, contract) ?? Promise.resolve<IngredientStatus>('optional'),
      this.deps.triage.shadow.probe(chainId, contract),
    ]);

    return {
      statuses: { sonar, score, worlds_manifest: worldsDetail.status, discord_observer, shadow_preview },
      worldSlug: worldsDetail.world_slug,
    };
  }

  private dispatchOne(ingredient: EnqueueIngredientKey, payload: HttpEnqueuePayload): Promise<DispatchResult> {
    switch (ingredient) {
      case 'worlds_manifest':
        return this.deps.dispatch!.manifestWorlds(payload);
      case 'score':
        return this.deps.dispatch!.registerScore(payload);
      case 'sonar':
        return this.deps.dispatch!.ingestSonar(payload);
    }
  }

  private payloadFor(orderId: string, inputs: CommunityOnboardingInputs): HttpEnqueuePayload {
    return {
      orderId,
      chainId: inputs.chain_id,
      contractAddress: inputs.contract_address,
      displayName: inputs.community_name ?? inputs.contract_address,
      contactEmail: inputs.contact_email,
      source: inputs.source,
    };
  }

  /** Monotonic pending → in_progress after a successful dispatch (merge can never downgrade). */
  private async markInProgress(orderId: string, ingredient: EnqueueIngredientKey): Promise<void> {
    const record = await this.deps.store.get(orderId);
    if (!record || isTerminal(record.state)) return;
    const merged = mergeProbedIngredients(record.ingredients, { [ingredient]: 'in_progress' });
    await this.deps.store.patchRecord(orderId, { ingredients: merged });
  }

  private async escalate(orderId: string, ingredient: string, reason: string): Promise<void> {
    const key = `${orderId}:${ingredient}`;
    if (this.escalated.has(key)) return;
    this.escalated.add(key);

    const idempotencyKey = `${orderId}:${ingredient}:escalate`;
    await this.emit(orderId, ORCHESTRATOR_SUBJECTS.escalate, OrchestratorEscalateSchema.parse({
      order_id: orderId,
      ingredient,
      reason,
      idempotency_key: idempotencyKey,
      at_unix: this.nowUnix(),
    }));
    await this.commentOnTrackingIssue(orderId, ingredient, reason, idempotencyKey);
  }

  /** Best-effort GitHub comment on the ingredient's tracking issue (D-2). No-op when the
   *  GitHub port is absent or no tracking issue was filed — the escalate EVENT is the guarantee. */
  private async commentOnTrackingIssue(
    orderId: string,
    ingredient: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (!this.deps.github) return;
    const record = await this.deps.store.get(orderId);
    const job = record?.ingredient_jobs?.find((j) => j.ingredient === ingredient && j.kind === 'github_issue');
    if (!job?.repo || !job.external_id) return;

    try {
      await this.deps.github.addComment({
        repo: job.repo,
        issueNumber: Number(job.external_id),
        body: [
          `**Orchestrator escalation** — ${reason}.`,
          '',
          `Order \`${orderId}\` fulfillment is paused on \`${ingredient}\`; operator action required.`,
        ].join('\n'),
        idempotencyKey,
      });
    } catch (e) {
      console.error('[fulfillment-orchestrator] escalation comment failed:', e instanceof Error ? e.message : e);
    }
  }

  private async emit(orderId: string, subject: string, payload: unknown): Promise<void> {
    await this.deps.store.appendEvent(orderId, { subject, payload });
  }

  private nowUnix(): number {
    return Math.floor(this.deps.now() / 1000);
  }
}

/**
 * Interval loop over non-terminal community-onboarding orders (sibling worker, D-1;
 * mirrors `ReProbeWorker`). One order is processed at most once per tick even though it
 * may appear under several state buckets between reads.
 */
export class FulfillmentOrchestratorWorker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly orchestrator: FulfillmentOrchestrator,
    private readonly store: OrderStore,
    private readonly intervalMs: number = reprobeIntervalMs(),
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    // The whole body is guarded: `start()` fires `void this.tick()`, so a throw from
    // `store.listByState` (outside the per-order try/catch) would become an
    // unhandledRejection and silently kill the worker. Log and let the interval retry.
    try {
      const states: OrderState[] = ['placed', 'routing', 'producing'];
      const seen = new Set<string>();
      for (const state of states) {
        const orders = await this.store.listByState(state);
        for (const order of orders) {
          if (order.product !== 'community-onboarding' || seen.has(order.order_id)) continue;
          seen.add(order.order_id);
          try {
            await this.orchestrator.processOrder(order.order_id);
          } catch (e) {
            console.error(
              '[fulfillment-orchestrator] tick failed:',
              order.order_id,
              e instanceof Error ? e.message : e,
            );
          }
        }
      }
    } catch (e) {
      console.error('[fulfillment-orchestrator] tick aborted:', e instanceof Error ? e.message : e);
    }
  }
}
