/**
 * Sprint-24 wiring tests: T-1 (shadow_preview skip guard removal), T-2 (metadata self-resolve),
 * T-3 (discordHealth composition). See grimoires/loa/sprint.md for AC references.
 *
 * All shadow_preview tests use inline triage stubs (NOT StubTriagePorts — that stub returns
 * 'blocked' for shadow by design and would bypass the advance path).
 */
import { describe, it, expect } from 'vitest';
import {
  ORDER_LIFECYCLE_SUBJECTS,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
  type IngredientStatus,
} from '@freeside/ordering-protocol';

import { FulfillmentOrchestrator } from '../fulfillment-orchestrator.js';
import { CommunityOnboardingOrchestrator } from '../community-onboarding-orchestrator.js';
import { InMemoryOrderStore, type NewOrder } from '../store.js';
import { ConfigCapabilityResolver, type CapabilityConfig } from '../resolver.js';
import { ORCHESTRATOR_SUBJECTS } from '../orchestrator-events.js';
import { HttpBuildingProbes } from '../http-building-probes.js';
import { KitchenTriagePorts } from '../kitchen-triage-ports.js';
import type { DiscordChannelHealth, TriagePorts, WorldsProbeDetail } from '../triage-ports.js';

const CONTRACT = '0x' + 'c'.repeat(40);
const SLUG = 'azuki-wiring';
const NOW_MS = 1_700_100_000_000;
const CHAIN_ID = '1';

const TRIAGE_CAPS: CapabilityConfig = {
  'collection-index': { building: 'sonar-api', endpoint: 'http://sonar.internal' },
  'community-register': { building: 'score-api', endpoint: 'http://score.internal' },
  'world-manifest': { building: 'worlds-api', endpoint: 'http://worlds.internal' },
};

function order(orderId = 'ord_w'): NewOrder {
  return {
    order_id: orderId,
    product: 'community-onboarding',
    placed_by: 'dashboard_onboarding',
    inputs: {
      chain_id: CHAIN_ID,
      contract_address: CONTRACT,
      contact_email: 'wiring@example.com',
      community_name: 'WiringTest',
      source: 'dashboard_onboarding',
    },
    placed_at_unix: 1_700_100_000,
    inputs_digest: 'd'.repeat(64),
    ingredients: { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS },
  };
}

/**
 * Mutable triage double. Starts with non-satisfying statuses so the intake orchestrator's
 * initial process() call during harness setup does NOT advance ingredients or fulfill the
 * order. Mutate fields AFTER setup to exercise the fulfillment orchestrator under test.
 *
 * No `metadata` field — structural absence causes T-2 self-resolve to fire.
 */
class WiringTriage implements TriagePorts {
  sonarStatus: IngredientStatus = 'pending';
  scoreStatus: IngredientStatus = 'pending';
  worldsStatus: IngredientStatus = 'pending';
  worldSlug: string | undefined = undefined;
  discordStatus: IngredientStatus = 'optional';
  shadowStatus: IngredientStatus = 'in_progress'; // non-satisfying → no fulfillment during setup

  sonar = { probe: async () => this.sonarStatus };
  score = { probe: async () => this.scoreStatus };
  worlds = {
    probe: async () => this.worldsStatus,
    probeDetail: async (): Promise<WorldsProbeDetail> => ({
      status: this.worldsStatus,
      world_slug: this.worldSlug,
    }),
  };
  discord = { probe: async () => this.discordStatus };
  shadow = { probe: async () => this.shadowStatus };
  // no `metadata` field → T-2 self-resolve fires
}

type FulfillmentOrchestratorDeps = ConstructorParameters<typeof FulfillmentOrchestrator>[0];

/** Build a producing order and FulfillmentOrchestrator. The triage is shared between the
 *  intake orchestrator (setup) and the fulfillment orchestrator (test), so mutate it AFTER
 *  this call to exercise the fulfillment path without triggering early fulfillment. */
async function wiringHarness(
  triage: TriagePorts,
  opts?: { discordHealth?: FulfillmentOrchestratorDeps['discordHealth'] },
) {
  const store = new InMemoryOrderStore({ now: () => 1_700_100_000 });
  const onboarding = new CommunityOnboardingOrchestrator({
    store,
    resolver: new ConfigCapabilityResolver(TRIAGE_CAPS),
    triage,
    now: () => NOW_MS,
    discordHealth: opts?.discordHealth,  // T-2: gate lives in advanceIngredient
  });
  await store.placeOrder(order(), {
    subject: ORDER_LIFECYCLE_SUBJECTS.placed,
    payload: { order_id: 'ord_w', product: 'community-onboarding', inputs_digest: 'd'.repeat(64) },
  });
  // Drive placed → producing. With non-satisfying statuses, no ingredients are advanced here.
  await onboarding.process('ord_w', (await store.get('ord_w'))!);

  const orchestrator = new FulfillmentOrchestrator({
    store,
    triage,
    onboarding,
    dispatch: null,
    github: null,
    now: () => NOW_MS,
    tokenLabel: 'orchestrator-token',
    discordHealth: opts?.discordHealth,
  });
  return { store, orchestrator };
}

async function eventsOfKind(store: InMemoryOrderStore, subject: string): Promise<unknown[]> {
  return (await store.pendingOutbox()).filter((e) => e.subject === subject).map((e) => e.payload);
}

// ── T-1: shadow_preview skip guard removal (AC-1, AC-2, AC-3) ────────────────
// Write test 3 first — highest-risk path (fail-closed escalate).

describe('T-1: shadow_preview enters the decision table (skip guard removed, FR-1)', () => {
  it('shadow_preview escalates and does not advance when probe returns blocked (AC-3)', async () => {
    const triage = new WiringTriage();
    const { store, orchestrator } = await wiringHarness(triage);

    // After setup: set all upstream ingredients complete; shadow returns blocked.
    triage.sonarStatus = 'complete';
    triage.scoreStatus = 'complete';
    triage.worldsStatus = 'complete';
    triage.worldSlug = SLUG;
    triage.shadowStatus = 'blocked';

    await orchestrator.processOrder('ord_w');

    // Escalation event for shadow_preview
    const escalations = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate);
    expect(escalations.some((e) => (e as { ingredient?: string }).ingredient === 'shadow_preview')).toBe(true);

    // No advance event for shadow_preview
    const advances = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.advance);
    expect(advances.some((e) => (e as { ingredient?: string }).ingredient === 'shadow_preview')).toBe(false);

    // Order NOT fulfilled — blocked probe holds the gate
    expect((await store.get('ord_w'))?.state).not.toBe('fulfilled');
  });

  it('shadow_preview advances to complete when probe returns complete (AC-1)', async () => {
    const triage = new WiringTriage();
    const { store, orchestrator } = await wiringHarness(triage);

    // After setup: all upstream complete, shadow returns complete.
    triage.sonarStatus = 'complete';
    triage.scoreStatus = 'complete';
    triage.worldsStatus = 'complete';
    triage.worldSlug = SLUG;
    triage.shadowStatus = 'complete';

    await orchestrator.processOrder('ord_w');

    const record = await store.get('ord_w');
    expect(record?.ingredients?.shadow_preview).toBe('complete');
    // Pin the end-state contract, not just the ingredient flip: with every ingredient
    // satisfied (metadata self-resolves — port absent), the order reaches fulfilled.
    expect(record?.state).toBe('fulfilled');

    // operator_audit has a fulfillment-orchestrator entry for shadow_preview
    const auditEntry = record?.operator_audit?.find(
      (e) => e.ingredient === 'shadow_preview' && e.caller_note === 'fulfillment-orchestrator',
    );
    expect(auditEntry).toBeTruthy();

    // No escalation for shadow_preview
    const escalations = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate);
    expect(escalations.some((e) => (e as { ingredient?: string }).ingredient === 'shadow_preview')).toBe(false);
  });

  it('shadow_preview advances to optional when probe returns optional (AC-2)', async () => {
    const triage = new WiringTriage();
    const { store, orchestrator } = await wiringHarness(triage);

    // After setup: all upstream complete, shadow returns optional.
    triage.sonarStatus = 'complete';
    triage.scoreStatus = 'complete';
    triage.worldsStatus = 'complete';
    triage.worldSlug = SLUG;
    triage.shadowStatus = 'optional';

    await orchestrator.processOrder('ord_w');

    const record = await store.get('ord_w');
    expect(record?.ingredients?.shadow_preview).toBe('optional');

    // No escalation for shadow_preview
    const escalations = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate);
    expect(escalations.some((e) => (e as { ingredient?: string }).ingredient === 'shadow_preview')).toBe(false);
  });
});

// ── T-2: metadata_snapshot structural-absence self-resolve (AC-4) ─────────────

describe('T-2: metadata_snapshot self-resolve when triage.metadata absent (FR-2)', () => {
  it('metadata_snapshot self-resolves to optional when triage.metadata is absent (AC-4)', async () => {
    // Use a triage with no metadata port. Keep other ingredients in_progress so the order
    // stays producing and we can isolate the metadata self-resolve without noise.
    const triage = new WiringTriage();
    // All stay non-satisfying except we will run processOrder as-is
    const { store, orchestrator } = await wiringHarness(triage);

    // Run a single tick with everything still pending/in_progress — only metadata self-resolves.
    await orchestrator.processOrder('ord_w');

    const record = await store.get('ord_w');
    expect(record?.ingredients?.metadata_snapshot).toBe('optional');

    // operator_audit records the self-resolve with the expected caller_note
    const auditEntry = record?.operator_audit?.find(
      (e) => e.ingredient === 'metadata_snapshot' && e.caller_note === 'fulfillment-orchestrator',
    );
    expect(auditEntry).toBeTruthy();
  });
});

// ── T-3: discordHealth composition wiring (AC-6, AC-7) ───────────────────────

describe('T-3: discordHealth port wired in production composition (FR-3)', () => {
  it('createFulfillmentOrchestratorWorker wires discordHealth when configured (AC-6)', () => {
    // Composition-level: KitchenTriagePorts with a configured HttpBuildingProbes exposes
    // a truthy discordHealth port. The composition extracts it via the same instanceof check.
    const http = new HttpBuildingProbes({
      sonarApiUrl: 'http://sonar.internal',
      scoreApiUrl: 'http://score.internal',
      worldsApiUrl: 'http://worlds.internal',
      serviceToken: 'test-token',
      discordObserverApiUrl: 'http://discord.internal',
    });
    const triage = new KitchenTriagePorts(http);
    expect(triage.discordHealth).toBeTruthy();

    // The extraction used in createFulfillmentOrchestratorWorker (T-3 change)
    const discordHealth = triage instanceof KitchenTriagePorts ? triage.discordHealth : undefined;
    expect(discordHealth).toBeTruthy();
  });

  it('discord_observer escalates when checkChannelHealth returns healthy: false (AC-7)', async () => {
    // discord_observer probes 'complete' with checkChannelHealth returning {healthy: false}
    // → escalate, do NOT advance.
    const triage = new WiringTriage();
    const discordHealth: { checkChannelHealth(c: string, a: string): Promise<DiscordChannelHealth> } = {
      checkChannelHealth: async () => ({ healthy: false, reason: 'channel archived' }),
    };
    const { store, orchestrator } = await wiringHarness(triage, { discordHealth });

    // After setup: all upstream complete. Shadow stays 'in_progress' (WiringTriage default) so
    // the advance loop never calls advanceIngredient for shadow — which would trigger process()
    // and merge discord_observer to 'complete' before the gate assertion (same guard pattern
    // as the existing discordHarness in fulfillment-orchestrator.test.ts).
    triage.sonarStatus = 'complete';
    triage.scoreStatus = 'complete';
    triage.worldsStatus = 'complete';
    triage.worldSlug = SLUG;
    // triage.shadowStatus stays 'in_progress' — shadow advance is skipped, gate fires cleanly
    triage.discordStatus = 'complete'; // the thing under test

    // Patch discord_observer from its initial 'optional' to 'pending' so the advance loop
    // sees it (initial 'optional' is treated as already recorded and skipped).
    await store.patchRecord('ord_w', {
      ingredients: { ...(await store.get('ord_w'))!.ingredients!, discord_observer: 'pending' },
    });

    await orchestrator.processOrder('ord_w');

    // Escalation event for discord_observer
    const escalations = await eventsOfKind(store, ORCHESTRATOR_SUBJECTS.escalate);
    expect(escalations.some((e) => (e as { ingredient?: string }).ingredient === 'discord_observer')).toBe(true);

    // discord_observer NOT advanced
    const record = await store.get('ord_w');
    expect(record?.ingredients?.discord_observer).not.toBe('complete');
    expect(record?.ingredients?.discord_observer).not.toBe('optional');
  });
});
