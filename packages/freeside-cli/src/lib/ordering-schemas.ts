/**
 * Ordering verb contracts (fulfillment-surface S2-T1, SDD D6).
 *
 * MIRRORS of the ordering-service public shapes — the CLI never imports the
 * platform packages (ADR-007 firewall; SDD §3.1 resolution). The service-side
 * authority is `PublicOrderSchema` in `@freeside/ordering-protocol`; drift is
 * caught by the env-gated differential test (S2-T6), not by a build-time import.
 *
 * Zero-dep: hand-rolled runtime guards, no zod.
 */

/** FR-7b — the ONE exit-code table (SDD D6 verbatim). Agents branch on these. */
export const EXIT = {
  OK: 0,
  USAGE: 1,
  UNREACHABLE: 2,
  API_ERROR: 3,
  AMBIGUOUS: 4, // ambiguous probe / blocked / CAS-lost
  WATCH_TIMEOUT: 5,
  ORDER_FAILED: 6,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const INGREDIENT_KEYS = [
  "sonar",
  "score",
  "worlds_manifest",
  "discord_observer",
  "shadow_preview",
] as const;
export type IngredientKey = (typeof INGREDIENT_KEYS)[number];

export const INGREDIENT_STATUSES = ["pending", "in_progress", "complete", "blocked", "optional"] as const;
export type IngredientStatus = (typeof INGREDIENT_STATUSES)[number];

export interface IngredientProbeMeta {
  status: IngredientStatus;
  probed_at_unix: number;
  source: "reprobe" | "interval" | "enqueue";
}

/** Mirror of the service's PublicOrder projection (SDD D7). */
export interface PublicOrder {
  order_id: string;
  product: string;
  state: string;
  placed_at_unix: number;
  updated_at_unix: number;
  recipe_id?: string;
  resolved_buildings?: unknown[];
  result_ref?: string;
  output?: unknown;
  refusal?: { code: string; reason: string };
  ingredients?: Partial<Record<IngredientKey, IngredientStatus>>;
  fulfillment?: { world_slug: string; [k: string]: unknown };
  ingredient_jobs?: unknown[];
  operator_audit?: unknown[];
  probe_meta?: Record<string, IngredientProbeMeta>;
}

/** Per-ingredient outcome in the reprobe response body. */
export interface ReprobeOutcome {
  status?: IngredientStatus;
  probed_at_unix: number;
  source: "reprobe";
  freshness: "fresh" | "ambiguous";
  error_class?: "timeout" | "probe_error";
}

/** FR-7a — the ONE error envelope every verb failure path emits. */
export interface ErrorEnvelope {
  error: string;
  http_status?: number;
  order_id?: string;
  hint?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Runtime guard for the PublicOrder mirror — rejects shape drift loudly (FR-7a). */
export function isPublicOrder(v: unknown): v is PublicOrder {
  if (!isObj(v)) return false;
  if (typeof v.order_id !== "string") return false;
  if (typeof v.product !== "string") return false;
  if (typeof v.state !== "string") return false;
  if (typeof v.placed_at_unix !== "number") return false;
  if (typeof v.updated_at_unix !== "number") return false;
  if (v.ingredients !== undefined && !isObj(v.ingredients)) return false;
  if (v.probe_meta !== undefined && !isObj(v.probe_meta)) return false;
  return true;
}

export function isErrorEnvelope(v: unknown): v is ErrorEnvelope {
  return isObj(v) && typeof v.error === "string";
}

/** Emit exactly one single-line JSON object (loa-cli convention — agent-friendly). */
export function emit(value: unknown): void {
  console.log(JSON.stringify(value));
}

/** Emit the FR-7a error envelope on stdout (single-line) and return the exit code. */
export function emitError(envelope: ErrorEnvelope, code: ExitCode): ExitCode {
  emit(envelope);
  return code;
}
