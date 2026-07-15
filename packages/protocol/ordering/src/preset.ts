import { z } from 'zod';
import { ProductId } from './order.js';

/**
 * A Preset is a FIXED recipe (the "Subway menu item") composed from declared capabilities.
 *
 * The recipe SHAPE is fixed here; the building ENDPOINTS are resolved at runtime by the
 * ordering service's capability resolver (agent-first: `loa where` / BeaconV3). This is the
 * Hybrid the operator chose — agent-first endpoint resolution, fixed menu item (PRD G-1/G-4).
 */

/** A capability a recipe step reads; the resolver maps it to a building + endpoint at runtime. */
export const CapabilityNeed = z.enum([
  'ownership',
  'value',
  'member-graph',
  'roles',
  'collection-index',
  'community-register',
  'metadata-snapshot',
  'world-manifest',
  'discord-observer',
  'shadow-preview-gate',
  'subject-resolution',
  'shadow-gate-leak',
]);
export type CapabilityNeed = z.infer<typeof CapabilityNeed>;

/** Triage capabilities for preset #2 (community-onboarding). */
export const TriageCapabilityNeed = z.enum([
  'collection-index',
  'community-register',
  'metadata-snapshot',
  'world-manifest',
  'discord-observer',
  'shadow-preview-gate',
]);
export type TriageCapabilityNeed = z.infer<typeof TriageCapabilityNeed>;

export const RecipeStepSchema = z
  .object({
    label: z.string().min(1),
    capability: CapabilityNeed,
  })
  .strict();
export type RecipeStep = z.infer<typeof RecipeStepSchema>;

export interface Preset {
  readonly id: ProductId;
  /** Validates OrderEnvelope.inputs for this product (the audit's gating_rule stays sealed in shadow-audit). */
  readonly inputSchema: z.ZodTypeAny;
  /** The capabilities this preset directly reads — declarative, resolver-facing. */
  readonly capabilityNeeds: readonly CapabilityNeed[];
  /** The fixed recipe shape. */
  readonly recipe: readonly RecipeStep[];
}

const NumericEvmChainId = z.string().regex(/^\d+$/, 'chain must be a numeric EVM chain id');
const EvmContractAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'contract must be a 0x-prefixed 20-byte EVM address');
const IsoCalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'expected a real calendar date');

/** Inputs for the access-risk-audit product (order-level only). */
export const AccessRiskAuditInputs = z
  .object({
    chain: z.string().min(1),
    contract: z.string().min(1),
    snapshot_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
    threshold: z.number().int().positive().optional(),
  })
  .strict();
export type AccessRiskAuditInputs = z.infer<typeof AccessRiskAuditInputs>;

/** Inputs for the community-onboarding product (dashboard counter-clerk). */
export const CommunityOnboardingInputs = z
  .object({
    chain_id: z.string().min(1),
    contract_address: z.string().min(1),
    contact_email: z.string().email(),
    community_name: z.string().min(1).optional(),
    source: z.literal('dashboard_onboarding'),
    callback_url: z.string().url().optional(),
  })
  .strict();
export type CommunityOnboardingInputs = z.infer<typeof CommunityOnboardingInputs>;

/** Anonymous-friendly input for the free gate-leak rung. Contact is excluded until explicit signup/consent. */
export const GateLeakInputs = z
  .object({
    chain_id: NumericEvmChainId,
    contract_address: EvmContractAddress,
    access_started_at: IsoCalendarDate.optional(),
    source: z.literal('public_gate_leak'),
    attribution: z.string().min(1).max(160).optional(),
  })
  .strict();
export type GateLeakInputs = z.infer<typeof GateLeakInputs>;

/** Ingredient checklist status for preset #2 poll UX. */
export const IngredientStatus = z.enum(['pending', 'in_progress', 'complete', 'blocked', 'optional']);
export type IngredientStatus = z.infer<typeof IngredientStatus>;

export const CommunityOnboardingIngredients = z
  .object({
    sonar: IngredientStatus,
    score: IngredientStatus,
    // Existing persisted onboarding rows predate this ingredient. Parse them as
    // opted-out; newly placed rows still initialize it to `pending` below.
    metadata_snapshot: IngredientStatus.default('optional'),
    worlds_manifest: IngredientStatus,
    discord_observer: IngredientStatus,
    shadow_preview: IngredientStatus,
  })
  .strict();
export type CommunityOnboardingIngredients = z.infer<typeof CommunityOnboardingIngredients>;

export const CommunityOnboardingOutput = z
  .object({
    world_slug: z.string().min(1),
    contact_email: z.string().email(),
    chain_id: z.string(),
    contract_address: z.string(),
    community_name: z.string().optional(),
  })
  .strict();
export type CommunityOnboardingOutput = z.infer<typeof CommunityOnboardingOutput>;

/** Initial ingredient state for a newly placed community-onboarding order. */
export const INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS: CommunityOnboardingIngredients = {
  sonar: 'pending',
  score: 'pending',
  metadata_snapshot: 'pending',
  worlds_manifest: 'pending',
  discord_observer: 'optional',
  shadow_preview: 'blocked',
};

/**
 * Preset #1 — the LADDER (PRD G-5): the audit reads the member-graph spine (which itself
 * composes ownership + value) plus the world's roles. It does NOT order sonar/score directly.
 */
export const ACCESS_RISK_AUDIT_PRESET: Preset = {
  id: 'access-risk-audit',
  inputSchema: AccessRiskAuditInputs,
  capabilityNeeds: ['member-graph', 'roles'],
  recipe: [
    { label: 'read member-graph spine (composes ownership + value)', capability: 'member-graph' },
    { label: 'read world roles for the CTA', capability: 'roles' },
  ],
};

/**
 * Preset #2 — triage ladder for dashboard onboarding: sonar index → score register →
 * worlds manifest → optional discord → shadow preview gate.
 */
export const COMMUNITY_ONBOARDING_PRESET: Preset = {
  id: 'community-onboarding',
  inputSchema: CommunityOnboardingInputs,
  capabilityNeeds: ['collection-index', 'community-register', 'world-manifest'],
  recipe: [
    { label: 'index collection on chain', capability: 'collection-index' },
    { label: 'register score-api community', capability: 'community-register' },
    { label: 'capture score metadata snapshot', capability: 'metadata-snapshot' },
    { label: 'write worlds manifest + slug', capability: 'world-manifest' },
    { label: 'optional discord observer', capability: 'discord-observer' },
    { label: 'enable shadow preview gate', capability: 'shadow-preview-gate' },
  ],
};

/** Preset #3 — the anonymous free rung. Unknown subjects index before compute. */
export const GATE_LEAK_PRESET: Preset = {
  id: 'gate-leak',
  inputSchema: GateLeakInputs,
  capabilityNeeds: ['subject-resolution', 'collection-index', 'shadow-gate-leak'],
  recipe: [
    { label: 'resolve canonical chain + contract subject', capability: 'subject-resolution' },
    { label: 'index collection when registry-unknown', capability: 'collection-index' },
    { label: 'compute public gate-leak report or typed prerequisite', capability: 'shadow-gate-leak' },
  ],
};

/** The preset registry — looked up by product id. */
export const PRESETS: Readonly<Record<ProductId, Preset>> = {
  'access-risk-audit': ACCESS_RISK_AUDIT_PRESET,
  'community-onboarding': COMMUNITY_ONBOARDING_PRESET,
  'gate-leak': GATE_LEAK_PRESET,
};

export function resolvePreset(product: ProductId): Preset {
  return PRESETS[product];
}
