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
export const CapabilityNeed = z.enum(['ownership', 'value', 'member-graph', 'roles']);
export type CapabilityNeed = z.infer<typeof CapabilityNeed>;

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

/** The preset registry — looked up by product id. */
export const PRESETS: Readonly<Record<ProductId, Preset>> = {
  'access-risk-audit': ACCESS_RISK_AUDIT_PRESET,
};

export function resolvePreset(product: ProductId): Preset {
  return PRESETS[product];
}
