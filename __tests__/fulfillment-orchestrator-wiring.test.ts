/**
 * Sprint-24 fulfillment orchestrator wiring — behavioral specification (AC-1 through AC-7).
 *
 * This file is the SEED-enumerated evidence path for NFR-6 (per-PR test floor).
 * Canonical runnable tests live at:
 *   packages/services/ordering/src/__tests__/fulfillment-orchestrator-wiring.test.ts
 *
 * The six acceptance-criteria covered here:
 *
 * T-1 (FR-1): shadow_preview skip guard removed — shadow enters the decision table.
 *   AC-1  shadow.probe returns 'complete'  → ingredient advances to 'complete'; audit trail set.
 *   AC-2  shadow.probe returns 'optional'  → ingredient advances to 'optional'; no escalation.
 *   AC-3  shadow.probe returns 'blocked'   → ingredient NOT advanced; escalation event emitted.
 *
 * T-2 (FR-2): metadata_snapshot structural-absence self-resolve.
 *   AC-4  triage.metadata is undefined     → ingredient advances to 'optional'; audit trail set.
 *
 * T-3 (FR-3): discordHealth port wired in production composition.
 *   AC-6  KitchenTriagePorts exposes discordHealth when HttpBuildingProbes configured.
 *   AC-7  discord_observer probes 'complete' + discordHealth returns {healthy:false} → escalate.
 *
 * Regression (T-5):
 *   AC-5  DevFallback E2E (metadata port present via StubTriagePorts) — self-resolve never fires.
 *   AC-8  discord = optional path — discord_observer advances even without discordHealth wired.
 *
 * Implementation references (file:line):
 *   FR-1 guard removal:   packages/services/ordering/src/fulfillment-orchestrator.ts:184
 *   FR-2 self-resolve:    packages/services/ordering/src/fulfillment-orchestrator.ts (ADVANCE loop)
 *   FR-3 composition:     packages/services/ordering/src/composition.ts:87–97
 *   discord gate logic:   packages/services/ordering/src/fulfillment-orchestrator.ts:197–208
 *
 * Wiring constraint: tests 1–4 use inline triage stubs, NOT StubTriagePorts.
 * StubTriagePorts returns 'blocked' for shadow by design and bypasses the advance path.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Type declarations matching the ordering-service public API (no import needed
// for the specification itself; runnable tests import from the package directly).
// ──────────────────────────────────────────────────────────────────────────────

type IngredientStatus = 'pending' | 'in_progress' | 'complete' | 'optional' | 'blocked' | 'failed';

interface TriagePorts {
  sonar: { probe: () => Promise<IngredientStatus> };
  score: { probe: () => Promise<IngredientStatus> };
  worlds: {
    probe: () => Promise<IngredientStatus>;
    probeDetail: () => Promise<{ status: IngredientStatus; world_slug?: string }>;
  };
  discord: { probe: () => Promise<IngredientStatus> };
  shadow: { probe: () => Promise<IngredientStatus> };
  metadata?: { probe: () => Promise<IngredientStatus> };
}

interface DiscordChannelHealth {
  healthy: boolean;
  reason?: string;
}

interface DiscordHealthPort {
  checkChannelHealth(channelId: string, guildId: string): Promise<DiscordChannelHealth>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Behavioral contract assertions (static, no runtime dependency)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * AC-1: shadow_preview advances to 'complete' when probe returns 'complete'.
 *
 * GIVEN  a producing order with upstream ingredients complete
 * AND    shadow.probe() returns 'complete'
 * WHEN   processOrder() runs a single tick
 * THEN   order.ingredients.shadow_preview === 'complete'
 * AND    operator_audit contains entry { ingredient: 'shadow_preview', caller_note: 'fulfillment-orchestrator' }
 * AND    no ORCHESTRATOR_SUBJECTS.escalate event for shadow_preview in outbox
 *
 * Implementation: fulfillment-orchestrator.ts ADVANCE loop — shadow enters actionForStatus
 * after the unconditional `if (ingredient === 'shadow_preview') continue` guard was removed (FR-1).
 */
const AC_1_CONTRACT = {
  description: 'shadow_preview advances to complete when probe returns complete',
  given: 'producing order; sonar/score/worlds/shadow_preview all complete; triage.shadow.probe = complete',
  then: [
    'ingredients.shadow_preview === "complete"',
    'operator_audit has entry for shadow_preview with caller_note "fulfillment-orchestrator"',
    'no escalate event for shadow_preview in outbox',
  ],
} as const;

/**
 * AC-2: shadow_preview advances to 'optional' when probe returns 'optional'.
 *
 * GIVEN  a producing order with upstream ingredients complete
 * AND    shadow.probe() returns 'optional'
 * WHEN   processOrder() runs a single tick
 * THEN   order.ingredients.shadow_preview === 'optional'
 * AND    no escalation event for shadow_preview
 */
const AC_2_CONTRACT = {
  description: 'shadow_preview advances to optional when probe returns optional',
  given: 'producing order; sonar/score/worlds complete; triage.shadow.probe = optional',
  then: ['ingredients.shadow_preview === "optional"', 'no escalate event for shadow_preview'],
} as const;

/**
 * AC-3: shadow_preview escalates and does NOT advance when probe returns 'blocked'.
 *
 * GIVEN  a producing order with upstream ingredients complete
 * AND    shadow.probe() returns 'blocked'
 * WHEN   processOrder() runs a single tick
 * THEN   an orders.orchestrator.escalate.v1 event with ingredient: 'shadow_preview' is in outbox
 * AND    ingredients.shadow_preview is unchanged (not 'complete' or 'optional')
 * AND    order.state !== 'fulfilled'
 *
 * This is the FAIL-CLOSED path — blocked probes must never silently pass.
 */
const AC_3_CONTRACT = {
  description: 'shadow_preview escalates and does not advance when probe returns blocked',
  given: 'producing order; sonar/score/worlds complete; triage.shadow.probe = blocked',
  then: [
    'escalate event with ingredient "shadow_preview" in outbox',
    'ingredients.shadow_preview !== "complete" and !== "optional"',
    'order.state !== "fulfilled"',
  ],
} as const;

/**
 * AC-4: metadata_snapshot self-resolves to 'optional' when triage.metadata is absent.
 *
 * GIVEN  a FulfillmentOrchestrator constructed with triage.metadata === undefined
 * AND    a producing order
 * WHEN   processOrder() runs a single tick
 * THEN   order.ingredients.metadata_snapshot === 'optional'
 * AND    operator_audit has entry { ingredient: 'metadata_snapshot', caller_note: 'fulfillment-orchestrator' }
 *
 * Gate condition: triage.metadata === undefined is structural (evaluated at construction time).
 * A configured endpoint that is temporarily DOWN returns 'pending' — port remains PRESENT,
 * self-resolve does NOT fire (NFR-5 fail-closed). This is intentional.
 */
const AC_4_CONTRACT = {
  description: 'metadata_snapshot self-resolves to optional when triage.metadata is absent',
  given: 'producing order; FulfillmentOrchestrator constructed with triage.metadata = undefined',
  then: [
    'ingredients.metadata_snapshot === "optional"',
    'operator_audit has entry for metadata_snapshot with caller_note "fulfillment-orchestrator"',
  ],
} as const;

/**
 * AC-6: createFulfillmentOrchestratorWorker wires discordHealth when configured.
 *
 * GIVEN  KitchenTriagePorts constructed with HttpBuildingProbes(discordObserverApiUrl set)
 * WHEN   the production composition extracts discordHealth via instanceof check
 * THEN   discordHealth is truthy (the port is wired)
 *
 * Composition pattern (composition.ts:87–97):
 *   const discordHealth = triage instanceof KitchenTriagePorts ? triage.discordHealth : undefined;
 */
const AC_6_CONTRACT = {
  description: 'createFulfillmentOrchestratorWorker wires discordHealth when configured',
  given: 'KitchenTriagePorts with HttpBuildingProbes(discordObserverApiUrl: "http://discord.internal")',
  then: ['triage.discordHealth is truthy', 'instanceof check extracts discordHealth successfully'],
} as const;

/**
 * AC-7: discord_observer escalates when checkChannelHealth returns { healthy: false }.
 *
 * GIVEN  discord.probe() returns 'complete'
 * AND    discordHealth.checkChannelHealth() returns { healthy: false, reason: ... }
 * WHEN   processOrder() runs with discord_observer in 'pending'
 * THEN   an escalation event for discord_observer is emitted
 * AND    ingredients.discord_observer remains unchanged (not advanced to 'complete' or 'optional')
 *
 * Gate logic: fulfillment-orchestrator.ts:197–208 checks discordHealth before advancing
 * discord_observer. A healthy:false result triggers escalation (D-2 path).
 */
const AC_7_CONTRACT = {
  description: 'discord_observer escalates when checkChannelHealth returns healthy: false',
  given: 'discord.probe = complete; discordHealth.checkChannelHealth returns {healthy: false}; discord_observer starts pending',
  then: [
    'escalate event with ingredient "discord_observer" in outbox',
    'ingredients.discord_observer not advanced',
  ],
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Regression contracts
// ──────────────────────────────────────────────────────────────────────────────

/**
 * AC-5 (regression): DevFallback E2E — metadata self-resolve never fires when port is present.
 *
 * The existing fulfillment-orchestrator-e2e.test.ts "drives a freshly placed order to
 * fulfilled with zero manual steps" DevFallback path exercises this:
 *   - tick 1: metadata_snapshot stays 'pending' (triage.metadata port is present via StubTriagePorts)
 *   - tick 2: dispatches after score probes 'complete'
 *
 * StubTriagePorts wires triage.metadata — so triage.metadata !== undefined — and the
 * structural-absence check at FR-2 never fires. No change to the E2E test file needed.
 */
const AC_5_REGRESSION = {
  description: 'DevFallback E2E passes unchanged — self-resolve never fires when metadata port present',
  file: 'packages/services/ordering/src/__tests__/fulfillment-orchestrator-e2e.test.ts',
  verification: 'run unchanged; tick1 leaves metadata_snapshot: pending; tick2 dispatches',
} as const;

/**
 * AC-8 (regression): discord = optional path — discord_observer advances without discordHealth wired.
 *
 * When FulfillmentOrchestrator is constructed WITHOUT discordHealth (discordHealth: undefined),
 * discord_observer follows the normal advance path (no health gate). The DevFallback E2E
 * covers this as the default configuration path.
 */
const AC_8_REGRESSION = {
  description: 'discord_observer advances even without discordHealth wired (D13.3 fallback)',
  file: 'packages/services/ordering/src/__tests__/fulfillment-orchestrator-e2e.test.ts',
  verification: 'run unchanged; discord_observer advances to optional in the E2E default path',
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// Sprint-24 contract manifest (machine-readable for harness consumption)
// ──────────────────────────────────────────────────────────────────────────────

export const SPRINT_24_WIRING_CONTRACTS = {
  sprint: 'sprint-24',
  feature: 'fulfillment-orchestrator-wiring',
  goals: ['G-2', 'G-3', 'G-4', 'G-5'],
  acceptance_criteria: {
    'AC-1': AC_1_CONTRACT,
    'AC-2': AC_2_CONTRACT,
    'AC-3': AC_3_CONTRACT,
    'AC-4': AC_4_CONTRACT,
    'AC-6': AC_6_CONTRACT,
    'AC-7': AC_7_CONTRACT,
  },
  regressions: {
    'AC-5': AC_5_REGRESSION,
    'AC-8': AC_8_REGRESSION,
  },
  canonical_test_file:
    'packages/services/ordering/src/__tests__/fulfillment-orchestrator-wiring.test.ts',
  nfr: 'NFR-6 (per-PR test floor)',
} as const;
