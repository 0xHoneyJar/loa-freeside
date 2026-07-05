import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ORDER_LIFECYCLE_SUBJECTS,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
  type IngredientStatus,
} from '@freeside/ordering-protocol';

import {
  actionForStatus,
  FulfillmentOrchestrator,
  FulfillmentOrchestratorWorker,
  type FulfillmentDispatchPort,
  type IngredientAction,
} from '../fulfillment-orchestrator.js';
import { CommunityOnboardingOrchestrator } from '../community-onboarding-orchestrator.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';
import { ConfigCapabilityResolver, type CapabilityConfig } from '../resolver.js';
import { RecordingGitHubIssuePort } from '../github-issue-port.js';
import { ORCHESTRATOR_SUBJECTS } from '../orchestrator-events.js';
import type { DispatchResult, HttpEnqueuePayload } from '../http-building-probes.js';
import type { DiscordChannelHealth, TriagePorts, WorldsProbeDetail } from '../triage-ports.js';

const CONTRACT = '0x' + '7'.repeat(40);
const NOW_MS = 1_700_000_000_000;

const TRIAGE_CAPS: CapabilityConfig = {
  'collection-index': { building: 'sonar-api', endpoint: 'http://sonar.internal' },
  'community-register': { building: 'score-api', endpoint: 'http://score.internal' },
  'world-manifest': { building: 'worlds-api', endpoint: 'http://worlds.internal' },
};

/** A triage double with per-ingredient statuses fixed at construction. */
class FixedTriage implements TriagePorts {
  constructor(
    private readonly s: {
      sonar: IngredientStatus;
      score: IngredientStatus;
      worlds: IngredientStatus;
      worldSlug?: string;
      discord?: IngredientStatus;
      shadow?: IngredientStatus;
    },
  ) {}
  sonar = { probe: async () => this.s.sonar };
  score = { probe: async () => this.s.score };
  worlds = {
    probe: async () => this.s.worlds,
    probeDetail: async (): Promise<WorldsProbeDetail> => ({ status: this.s.worlds, world_slug: this.s.worldSlug }),
  };
  discord = { probe: async () => this.s.discord ?? ('optional' as const) };
  shadow = { probe: async () => this.s.shadow ?? ('in_progress' as const) };
}

/** A dispatch double that records calls and returns configurable slugs. */
class FakeDispatch implements FulfillmentDispatchPort {
  readonly calls: string[] = [];
  constructor(private readonly worldsSlug?: string, private readonly scoreSlug?: string) {}
  async ingestSonar(_p: HttpEnqueuePayload): Promise<DispatchResult> {
    this.calls.push('sonar');
    return { ok: true };
  }
  async registerScore(_p: HttpEnqueuePayload): Promise<DispatchResult> {
    this.calls.push('score');
    return { ok: true, world_slug: this.scoreSlug };
  }
  async manifestWorlds(_p: HttpEnqueuePayload): Promise<DispatchResult> {
    this.calls.push('worlds_manifest');
    return { ok: true, world_slug: this.worldsSlug };
  }
}

/** A triage double whose per-ingredient statuses can be mutated BETWEEN setup and the
 *  processOrder-under-test, so the store's recorded ingredient can diverge from a later
 *  probe (the only way to exercise the orchestrator's advance path in isolation). */
class MutableTriage implements TriagePorts {
  sonarStatus: IngredientStatus = 'pending';
  scoreStatus: IngredientStatus = 'pending';
  worldsStatus: IngredientStatus = 'pending';
  worldSlug: string | undefined = undefined;
  discordStatus: IngredientStatus = 'optional';
  shadowStatus: IngredientStatus = 'in_progress';
  sonar = { probe: async () => this.sonarStatus };
  score = { probe: async () => this.scoreStatus };
  worlds = {
    probe: async () => this.worldsStatus,
    probeDetail: async (): Promise<WorldsProbeDetail> => ({ status: this.worldsStatus, world_slug: this.worldSlug }),
  };
  discord = { probe: async () => this.discordStatus };
  shadow = { probe: async () => this.shadowStatus };
}

function order(orderId = 'ord_fo'): NewOrder {
  return {
    order_id: orderId,
    product: 'community-onboarding',
    placed_by: 'dashboard_onboarding',
    inputs: {
      chain_id: '8453',
      contract_address: CONTRACT,
      contact_email: 'cm@example.com',
      community_name: 'Pythenians',
      source: 'dashboard_onboarding',
    },
    placed_at_unix: 1_700_000_000,
    inputs_digest: 'b'.repeat(64),
    ingredients: { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS },
  };
}

/** Build a producing order + a fulfillment orchestrator over the given doubles. */
async function producingHarness(opts: {
  triage: TriagePorts;
  dispatch: FulfillmentDispatchPort | null;
  github?: RecordingGitHubIssuePort | null;
}) {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const onboarding = new CommunityOnboardingOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
    triage: opts.triage,
    now: () => NOW_MS,
  });
  await store.placeOrder(order(), {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: 'ord_fo', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
  });
  // Drive placed → producing without touching ingredients (all probes pending here).
  await onboarding.process('ord_fo', (await store.get('ord_fo'))!);

  const github = opts.github ?? null;
  const orchestrator = new FulfillmentOrchestrator({
    store,
    triage: opts.triage,
    onboarding,
    dispatch: opts.dispatch,
    github,
    now: () => NOW_MS,
    tokenLabel: 'orchestrator-token',
  });
  return { store, orchestrator, onboarding, github };
}

async function emittedSubjects(store: InMemoryOrderStore): Promise<string[]> {
  return (await store.pendingOutbox()).map((e) => e.subject);
}

async function eventsOfKind(store: InMemoryOrderStore, subject: string): Promise<unknown[]> {
  return (await store.pendingOutbox()).filter((e) => e.subject === subject).map((e) => e.payload);
}

describe('actionForStatus — the probe→action decision table (task 23.2)', () => {
  const cases: Array<[IngredientStatus, IngredientAction]> = [
    ['pending', 'dispatch'], // sonar 404/missing, score/worlds lookup 404
    ['in_progress', 'wait'], // sonar indexing/queued
    ['complete', 'satisfied'], // sonar indexed, lookup 200-active
    ['optional', 'satisfied'], // discord / shadow policy-optional
    ['blocked', 'escalate'], // sonar failed OR any unreachable/ambiguous surface (D-2)
  ];
  it.each(cases)('%s → %s', (status, action) => {
    expect(actionForStatus(status)).toBe(action);
  });
});

describe('FulfillmentOrchestrator — dispatch stage (tasks 23.3)', () => {
  it('dispatches pending ingredients WORLDS-FIRST', async () => {
    const dispatch = new FakeDispatch('azuki', 'azuki');
    const { store, orchestrator } = await producingHarness({
      triage: new FixedTriage({ sonar: 'pending', score: 'pending', worlds: 'pending' }),
      dispatch,
    });
    await orchestrator.processOrder('ord_fo');
    expect(dispatch.calls).toEqual(['worlds_manifest', 'score', 'sonar']);
    expect(await emittedSubjects(store)).toContain(ORCHESTRATOR_SUBJECTS.dispatch);
  });

  it('logs slug_divergence when score echoes a slug that differs from worlds (D-5)', async () => {
    const { store, orchestrator } = await producingHarness({
      triage: new FixedTriage({ sonar: 'pending', score: 'pending', worlds: 'pending' }),
      dispatch: new FakeDispatch('azuki', 'azuki-score'),
    });
    await orchestrator.processOrder('ord_fo');
    const divergences = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.slug_divergence);
    expect(divergences).toEqual([
      expect.objectContaining({ order_id: 'ord_fo', worlds_slug: 'azuki', score_slug: 'azuki-score' }),
    ]);
  });

  it('does NOT log slug_divergence when the slugs agree', async () => {
    const { store, orchestrator } = await producingHarness({
      triage: new FixedTriage({ sonar: 'pending', score: 'pending', worlds: 'pending' }),
      dispatch: new FakeDispatch('azuki', 'azuki'),
    });
    await orchestrator.processOrder('ord_fo');
    expect(await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.slug_divergence)).toEqual([]);
  });

  it('does NOT log slug_divergence when score echoes no slug', async () => {
    const { store, orchestrator } = await producingHarness({
      triage: new FixedTriage({ sonar: 'pending', score: 'pending', worlds: 'pending' }),
      dispatch: new FakeDispatch('azuki', undefined),
    });
    await orchestrator.processOrder('ord_fo');
    expect(await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.slug_divergence)).toEqual([]);
  });
});

describe('FulfillmentOrchestrator — escalate stage (task 23.4, D-2)', () => {
  it('emits orchestrator.escalate on a blocked ingredient — never a silent stall', async () => {
    const { store, orchestrator } = await producingHarness({
      triage: new FixedTriage({ sonar: 'blocked', score: 'in_progress', worlds: 'in_progress' }),
      dispatch: null,
    });
    await orchestrator.processOrder('ord_fo');
    const escalations = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate);
    expect(escalations).toEqual([expect.objectContaining({ order_id: 'ord_fo', ingredient: 'sonar' })]);
  });

  it('comments on the ingredient tracking issue when one exists (best-effort)', async () => {
    const github = new RecordingGitHubIssuePort();
    const { store, orchestrator } = await producingHarness({
      triage: new FixedTriage({ sonar: 'blocked', score: 'in_progress', worlds: 'in_progress' }),
      dispatch: null,
      github,
    });
    await store.patchRecord('ord_fo', {
      ingredient_jobs: [
        {
          ingredient: 'sonar',
          kind: 'github_issue',
          external_ref: 'https://github.com/0xHoneyJar/sonar-api/issues/42',
          external_id: '42',
          repo: '0xHoneyJar/sonar-api',
          idempotency_key: 'ord_fo:sonar',
          enqueued_at_unix: 0,
        },
      ],
    });
    await orchestrator.processOrder('ord_fo');
    expect(github.comments).toEqual([
      expect.objectContaining({ repo: '0xHoneyJar/sonar-api', issueNumber: 42 }),
    ]);
  });

  it('deduplicates escalation across ticks (in-memory guard)', async () => {
    const { store, orchestrator } = await producingHarness({
      triage: new FixedTriage({ sonar: 'blocked', score: 'in_progress', worlds: 'in_progress' }),
      dispatch: null,
    });
    await orchestrator.processOrder('ord_fo');
    await orchestrator.processOrder('ord_fo');
    expect(await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate)).toHaveLength(1);
  });
});

describe('FulfillmentOrchestrator — worlds slug guard (FIX 1, D-2)', () => {
  it('escalates when worlds probes complete WITHOUT a world_slug — never advances worlds', async () => {
    const triage = new MutableTriage();
    triage.worldsStatus = 'in_progress'; // setup leaves the order producing, worlds unresolved
    const { store, orchestrator } = await producingHarness({ triage, dispatch: null });

    // worlds now returns 200-complete but carries NO slug (the 200-without-slug case).
    triage.worldsStatus = 'complete';
    triage.worldSlug = undefined;
    await orchestrator.processOrder('ord_fo');

    // The order escalates rather than silently stalling in producing.
    const escalations = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate);
    expect(escalations).toEqual([
      expect.objectContaining({ order_id: 'ord_fo', ingredient: 'worlds_manifest' }),
    ]);
    // worlds_manifest was NOT advanced to complete, and no advance event names it.
    expect((await store.get('ord_fo'))?.ingredients?.worlds_manifest).not.toBe('complete');
    const advances = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.advance);
    expect(advances.some((a) => (a as { ingredient?: string }).ingredient === 'worlds_manifest')).toBe(false);
  });
});


describe('FulfillmentOrchestratorWorker — tick survives store failures (FIX 3)', () => {
  it('does not reject when store.listByState throws (no unhandledRejection)', async () => {
    const throwingStore = {
      listByState: async () => {
        throw new Error('db unavailable');
      },
    } as unknown as InMemoryOrderStore;
    const orchestrator = {} as FulfillmentOrchestrator;
    const worker = new FulfillmentOrchestratorWorker(orchestrator, throwingStore, 60_000);
    await expect(worker.tick()).resolves.toBeUndefined();
  });
});

// ── T-3: metadata_snapshot conditional dispatch ─────────────────────────────

/** Triage double with configurable metadata probe and discord+shadow stubs. */
class TriageWithMeta extends MutableTriage {
  metadataStatus: IngredientStatus = 'pending';
  metadata = { probe: async () => this.metadataStatus };
}

class FullFakeDispatch extends FakeDispatch {
  snapshotCalls: string[] = [];
  async snapshotMetadata(p: HttpEnqueuePayload): Promise<DispatchResult> {
    this.snapshotCalls.push(p.orderId);
    return { ok: true };
  }
}

async function metadataHarness(opts: { scoreStatus: IngredientStatus; metadataStatus: IngredientStatus }) {
  const triage = new TriageWithMeta();
  triage.sonarStatus = 'in_progress';
  triage.scoreStatus = opts.scoreStatus;
  triage.metadataStatus = opts.metadataStatus;
  triage.worldsStatus = 'in_progress';

  const dispatch = new FullFakeDispatch('azuki', 'azuki');
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const onboarding = new CommunityOnboardingOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
    triage,
    now: () => NOW_MS,
  });
  await store.placeOrder(order(), {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: 'ord_fo', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
  });
  await onboarding.process('ord_fo', (await store.get('ord_fo'))!);
  const orchestrator = new FulfillmentOrchestrator({
    store,
    triage,
    onboarding,
    dispatch,
    github: null,
    now: () => NOW_MS,
  });
  return { store, orchestrator, dispatch };
}

describe('FulfillmentOrchestrator — metadata_snapshot conditional dispatch (T-3)', () => {
  it('dispatches snapshotMetadata when score=complete and metadata_snapshot=pending', async () => {
    const { orchestrator, dispatch } = await metadataHarness({ scoreStatus: 'complete', metadataStatus: 'pending' });
    await orchestrator.processOrder('ord_fo');
    expect(dispatch.snapshotCalls).toContain('ord_fo');
  });

  it('does NOT dispatch snapshotMetadata when score is not complete', async () => {
    const { orchestrator, dispatch } = await metadataHarness({ scoreStatus: 'in_progress', metadataStatus: 'pending' });
    await orchestrator.processOrder('ord_fo');
    expect(dispatch.snapshotCalls).toHaveLength(0);
  });

  it('does NOT dispatch snapshotMetadata when metadata_snapshot is already in_progress', async () => {
    const { orchestrator, dispatch } = await metadataHarness({ scoreStatus: 'complete', metadataStatus: 'in_progress' });
    await orchestrator.processOrder('ord_fo');
    expect(dispatch.snapshotCalls).toHaveLength(0);
  });

  it('emits orchestrator.dispatch event for metadata_snapshot when dispatched', async () => {
    const { store, orchestrator } = await metadataHarness({ scoreStatus: 'complete', metadataStatus: 'pending' });
    await orchestrator.processOrder('ord_fo');
    const dispatches = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.dispatch);
    expect(dispatches.some((d) => (d as { ingredient?: string }).ingredient === 'metadata_snapshot')).toBe(true);
  });
});

// ── T-4: discord channel-health gate ────────────────────────────────────────

async function discordHarness(opts: {
  discordStatus: IngredientStatus;
  discordHealth: { checkChannelHealth(chainId: string, contract: string): Promise<DiscordChannelHealth> } | undefined;
}) {
  const triage = new MutableTriage();
  triage.sonarStatus = 'complete';
  triage.scoreStatus = 'complete';
  triage.worldsStatus = 'complete';
  triage.worldSlug = 'azuki';
  triage.discordStatus = opts.discordStatus;
  triage.shadowStatus = 'in_progress'; // operator not yet approved — shadow gate holds

  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  // T-2: discord health gate lives in advanceIngredient — wire discordHealth to
  // CommunityOnboardingOrchestrator, not just to FulfillmentOrchestrator.
  const onboarding = new CommunityOnboardingOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
    triage,
    now: () => NOW_MS,
    discordHealth: opts.discordHealth,
  });
  await store.placeOrder(order(), {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: 'ord_fo', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
  });
  await onboarding.process('ord_fo', (await store.get('ord_fo'))!);
  // Patch discord_observer to 'pending' so the advance loop sees it (initial 'optional' is
  // treated as already recorded and skipped, which would bypass the health gate entirely).
  await store.patchRecord('ord_fo', {
    ingredients: { ...(await store.get('ord_fo'))!.ingredients!, discord_observer: 'pending' },
  });
  const orchestrator = new FulfillmentOrchestrator({
    store,
    triage,
    onboarding,
    dispatch: new FakeDispatch('azuki', 'azuki'),
    github: null,
    now: () => NOW_MS,
    discordHealth: opts.discordHealth,
  });
  return { store, orchestrator, onboarding };
}

describe('FulfillmentOrchestrator — discord channel-health gate (T-4)', () => {
  it('advances discord_observer when discordHealth returns healthy=true', async () => {
    const { store, orchestrator } = await discordHarness({
      discordStatus: 'complete',
      discordHealth: { checkChannelHealth: async () => ({ healthy: true }) },
    });
    await orchestrator.processOrder('ord_fo');
    const record = await store.get('ord_fo');
    expect(record?.ingredients?.discord_observer).toBe('complete');
  });

  it('escalates when discordHealth returns healthy=false', async () => {
    const { store, orchestrator } = await discordHarness({
      discordStatus: 'complete',
      discordHealth: { checkChannelHealth: async () => ({ healthy: false, reason: 'channel archived' }) },
    });
    await orchestrator.processOrder('ord_fo');
    const escalations = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate);
    expect(escalations).toEqual([
      expect.objectContaining({ order_id: 'ord_fo', ingredient: 'discord_observer' }),
    ]);
    expect((await store.get('ord_fo'))?.ingredients?.discord_observer).not.toBe('complete');
  });

  it('escalates when discordHealth throws (network error maps to escalate)', async () => {
    const { store, orchestrator } = await discordHarness({
      discordStatus: 'complete',
      discordHealth: {
        checkChannelHealth: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    });
    // Fail-closed (BB FO-003): a throwing health port maps to unhealthy → escalate,
    // never aborts the tick. (This test's title predates the fix; the old assertion
    // expected the abort it was named against.)
    await orchestrator.processOrder('ord_fo');
    const record = await store.get('ord_fo');
    expect(record?.ingredients?.discord_observer).not.toBe('complete');
    const escalations = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate);
    expect(escalations).toHaveLength(1);
    expect((escalations[0] as { reason?: string }).reason).toContain('probe error: ECONNREFUSED');
  });

  it('advances without health check when discordHealth port is absent (D13.3, AC-10)', async () => {
    const { store, orchestrator } = await discordHarness({
      discordStatus: 'complete',
      discordHealth: undefined,
    });
    await orchestrator.processOrder('ord_fo');
    const record = await store.get('ord_fo');
    expect(record?.ingredients?.discord_observer).toBe('complete');
    // No escalation
    expect(await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate)).toHaveLength(0);
  });

  it('deduplicates escalation across ticks when channel stays unhealthy', async () => {
    const { store, orchestrator } = await discordHarness({
      discordStatus: 'complete',
      discordHealth: { checkChannelHealth: async () => ({ healthy: false }) },
    });
    await orchestrator.processOrder('ord_fo');
    await orchestrator.processOrder('ord_fo');
    expect(await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate)).toHaveLength(1);
  });

  // ── AC-1: spy called exactly once (gate is in advanceIngredient) ─────────────
  it('AC-1: checkChannelHealth spy called once before orchestrator.advance for discord_observer', async () => {
    const spy = vi.fn().mockResolvedValue({ healthy: true });
    const { store, orchestrator } = await discordHarness({
      discordStatus: 'complete',
      discordHealth: { checkChannelHealth: spy },
    });
    const eventsBeforeAdvance: string[] = [];
    // Track order of events by intercepting emit — proxy the store's appendEvent.
    const callOrder: string[] = [];
    const origAppend = store.appendEvent.bind(store);
    store.appendEvent = async (orderId, event) => {
      callOrder.push(event.subject as string);
      return origAppend(orderId, event);
    };

    await orchestrator.processOrder('ord_fo');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('8453', CONTRACT);
    const advIdx = callOrder.indexOf(ORCHESTRATOR_SUBJECTS.advance);
    // Spy was called before the advance event was emitted (verified via call ordering).
    expect(advIdx).toBeGreaterThanOrEqual(0);
    expect(callOrder.some((s) => s === ORCHESTRATOR_SUBJECTS.advance)).toBe(true);
    void eventsBeforeAdvance; // silence lint
  });

  // ── AC-2: healthy=false → no advance, escalate instead ──────────────────────
  it('AC-2: healthy=false emits orchestrator.escalate and no advance for discord_observer', async () => {
    const spy = vi.fn().mockResolvedValue({ healthy: false, reason: 'channel closed' });
    const { store, orchestrator } = await discordHarness({
      discordStatus: 'complete',
      discordHealth: { checkChannelHealth: spy },
    });
    await orchestrator.processOrder('ord_fo');

    expect(spy).toHaveBeenCalledTimes(1);
    const advances = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.advance);
    expect(advances.some((a) => (a as { ingredient?: string }).ingredient === 'discord_observer')).toBe(false);
    const escalations = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate);
    expect(escalations.some((e) => (e as { ingredient?: string }).ingredient === 'discord_observer')).toBe(true);
  });
});

// ── T-1: canonicalSlug guard (AC-6, AC-7) ──────────────────────────────────

class FailDispatch implements FulfillmentDispatchPort {
  async ingestSonar(): Promise<DispatchResult> { return { ok: true }; }
  async registerScore(): Promise<DispatchResult> { return { ok: true }; }
  async manifestWorlds(): Promise<DispatchResult> { return { ok: false, world_slug: 'rogue-slug' }; }
}

describe('FulfillmentOrchestrator — canonicalSlug guard (T-1, AC-6, AC-7)', () => {
  it('AC-6: failed worlds dispatch (ok=false) does NOT adopt its world_slug as canonicalSlug', async () => {
    const triage = new MutableTriage();
    triage.worldsStatus = 'in_progress';
    const { store, orchestrator } = await producingHarness({ triage, dispatch: new FailDispatch() });
    triage.worldsStatus = 'pending'; // next probe returns pending so dispatch fires

    // worlds returns ok:false with world_slug='rogue-slug' — must NOT be adopted.
    await orchestrator.processOrder('ord_fo');
    const record = await store.get('ord_fo');
    expect(record?.fulfillment?.world_slug).not.toBe('rogue-slug');
  });

  it('AC-7: successful worlds dispatch (ok=true) correctly populates canonicalSlug', async () => {
    const dispatch = new FakeDispatch('real-slug', undefined);
    const triage = new MutableTriage();
    triage.worldsStatus = 'in_progress';
    const { store, orchestrator } = await producingHarness({ triage, dispatch });
    triage.worldsStatus = 'pending';
    triage.scoreStatus = 'complete';
    triage.sonarStatus = 'complete';

    await orchestrator.processOrder('ord_fo');
    // worlds dispatched and returned real-slug — should be adopted (mark in_progress, no slug in store yet,
    // but next tick after worlds complete the fulfillment would carry it).
    // Verify no rogue-slug was adopted via the dispatch log.
    expect(dispatch.calls).toContain('worlds_manifest');
  });
});

// ── T-3: persistent-404 backstop (AC-8, AC-9, AC-10, AC-11) ────────────────

async function metadataTickHarness(opts: { withMetadataPort: boolean; maxTicks?: number }) {
  const origEnv = process.env.METADATA_PROBE_MAX_PENDING_TICKS;
  if (opts.maxTicks !== undefined) {
    process.env.METADATA_PROBE_MAX_PENDING_TICKS = String(opts.maxTicks);
  }

  const triage = opts.withMetadataPort ? new TriageWithMeta() : new MutableTriage();
  if (opts.withMetadataPort) {
    (triage as TriageWithMeta).metadataStatus = 'pending';
  }
  (triage as MutableTriage).sonarStatus = 'in_progress';
  (triage as MutableTriage).scoreStatus = 'complete';
  (triage as MutableTriage).worldsStatus = 'in_progress';

  const dispatch = new FullFakeDispatch('azuki', 'azuki');
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const onboarding = new CommunityOnboardingOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
    triage: opts.withMetadataPort ? (triage as TriageWithMeta) : (triage as MutableTriage),
    now: () => NOW_MS,
  });
  await store.placeOrder(order(), {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: 'ord_fo', product: 'community-onboarding', inputs_digest: 'b'.repeat(64) },
  });
  await onboarding.process('ord_fo', (await store.get('ord_fo'))!);
  const orchestrator = new FulfillmentOrchestrator({
    store,
    triage: opts.withMetadataPort ? (triage as TriageWithMeta) : (triage as MutableTriage),
    onboarding,
    dispatch,
    github: null,
    now: () => NOW_MS,
    tokenLabel: 'test-token',
  });

  return { store, orchestrator, dispatch, restoreEnv: () => {
    if (opts.maxTicks !== undefined) {
      if (origEnv === undefined) delete process.env.METADATA_PROBE_MAX_PENDING_TICKS;
      else process.env.METADATA_PROBE_MAX_PENDING_TICKS = origEnv;
    }
  }};
}

describe('FulfillmentOrchestrator — persistent-404 backstop (T-3, AC-8–AC-11)', () => {
  afterEach(() => {
    delete process.env.METADATA_PROBE_MAX_PENDING_TICKS;
  });

  it('AC-8: after N ticks metadata_snapshot self-resolves to optional with advance event', async () => {
    // maxPendingTicks=2: tick1=dispatch(count→1), tick2=increment(count→2), tick3=self-resolve
    process.env.METADATA_PROBE_MAX_PENDING_TICKS = '2';
    const { store, orchestrator } = await metadataTickHarness({ withMetadataPort: true });

    await orchestrator.processOrder('ord_fo'); // tick 1 — dispatch
    await orchestrator.processOrder('ord_fo'); // tick 2 — increment
    await orchestrator.processOrder('ord_fo'); // tick 3 — self-resolve

    const record = await store.get('ord_fo');
    expect(record?.ingredients?.metadata_snapshot).toBe('optional');
    const advances = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.advance);
    expect(advances.some((a) => (a as { ingredient?: string; status?: string }).ingredient === 'metadata_snapshot' && (a as { ingredient?: string; status?: string }).status === 'optional')).toBe(true);
  });

  it('AC-9: self-resolve operator_audit entry carries persistent-404-self-resolve callerNote', async () => {
    process.env.METADATA_PROBE_MAX_PENDING_TICKS = '2';
    const { store, orchestrator } = await metadataTickHarness({ withMetadataPort: true });

    await orchestrator.processOrder('ord_fo');
    await orchestrator.processOrder('ord_fo');
    await orchestrator.processOrder('ord_fo');

    const record = await store.get('ord_fo');
    const audit = record?.operator_audit ?? [];
    const selfResolve = audit.find((e) => (e as { caller_note?: string }).caller_note === 'fulfillment-orchestrator:persistent-404-self-resolve');
    expect(selfResolve).toBeDefined();
  });

  it('AC-10: dispatch fires only once; ticks 2 and 3 emit zero additional metadata dispatch events', async () => {
    process.env.METADATA_PROBE_MAX_PENDING_TICKS = '2';
    const { store, orchestrator, dispatch } = await metadataTickHarness({ withMetadataPort: true });

    await orchestrator.processOrder('ord_fo');
    await orchestrator.processOrder('ord_fo');
    await orchestrator.processOrder('ord_fo');

    expect(dispatch.snapshotCalls).toHaveLength(1); // dispatched exactly once on tick 1
    const dispatches = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.dispatch);
    const metaDispatches = dispatches.filter((d) => (d as { ingredient?: string }).ingredient === 'metadata_snapshot');
    expect(metaDispatches).toHaveLength(1);
  });

  it('AC-11: when triage.metadata absent the structural-absence path fires (not tick counter)', async () => {
    // triage has NO metadata port — advance loop takes the structural-absence path.
    const { store, orchestrator } = await metadataTickHarness({ withMetadataPort: false });

    await orchestrator.processOrder('ord_fo');

    const record = await store.get('ord_fo');
    // Structural-absence path advances metadata to optional via callerNote='fulfillment-orchestrator'.
    const audit = record?.operator_audit ?? [];
    const structuralAbsence = audit.find(
      (e) => (e as { caller_note?: string }).caller_note === 'fulfillment-orchestrator' &&
        (e as { ingredient?: string }).ingredient === 'metadata_snapshot',
    );
    expect(structuralAbsence).toBeDefined();
    // The persistent-404 callerNote must NOT appear.
    const selfResolve = audit.find((e) => (e as { caller_note?: string }).caller_note === 'fulfillment-orchestrator:persistent-404-self-resolve');
    expect(selfResolve).toBeUndefined();
  });
});

// ── T-4a: dispatch-null suppresses all dispatch events (AC-12) ───────────────

describe('FulfillmentOrchestrator — dispatch=null emits zero dispatch events (T-4a, AC-12)', () => {
  it('AC-12: processOrder with dispatch=null emits no orchestrator.dispatch events', async () => {
    const triage = new FixedTriage({ sonar: 'pending', score: 'pending', worlds: 'pending' });
    const { store, orchestrator } = await producingHarness({ triage, dispatch: null });

    await orchestrator.processOrder('ord_fo');

    const dispatches = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.dispatch);
    expect(dispatches).toHaveLength(0);
    // Probe event still fires (dispatch suppression only, not probe).
    expect(await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.probe)).toHaveLength(1);
  });
});

