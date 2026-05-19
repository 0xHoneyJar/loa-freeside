/**
 * Tenant routing table — Effect.Schema edition.
 *
 * Replaces hand-written TypeScript types with `Effect.Schema` definitions.
 * Schema gives us, in one place:
 *   - the static TS type      (via Schema.Schema.Type<typeof X>)
 *   - runtime validation       (via Schema.decodeUnknownSync — throws on invalid)
 *   - field-level refinement   (Schema.pattern, Schema.maxLength, ...)
 *   - JSON Schema export       (via JSONSchema.make — used by /schema/*.json)
 *
 * ── Four-axis ownership (per `[[gateway-as-registry]]`) ──────────────────
 *
 * The gateway is a registry, not a vault. Each field in this file falls
 * into one of two categories:
 *
 *   A. **Registry policy (curator-owned, persists in tenants.ts always)**
 *        - slug                — routing identifier
 *        - upstream            — where the gateway forwards to
 *        - visibility          — which manifests list this tenant
 *        - access              — gateway-side gate (open / api-key / x402)
 *        - status              — paused returns 503 without removing tenant
 *
 *   B. **Upstream broadcast (transitional in v0.2 — curator-encoded as
 *      FALLBACK; will be discovered from upstream's federation-extended
 *      `/.well-known/mcp.json` in v0.3)**
 *        - name, description, publisher  — upstream identity
 *        - auth, authHeader              — upstream's auth requirement
 *        - capabilities                  — MCP capability set
 *        - pricing                       — upstream's pricing declaration
 *        - owner                         — upstream's contact
 *        - documentation                 — upstream's docs URL
 *
 * Decode-at-boot is fast-fail: a malformed tenants.ts crashes the gateway
 * at boot rather than serving broken routes. v0.3 broadcast layer adds an
 * upstream-fetch step that overlays/replaces category B at boot or refresh.
 */

import { Schema } from "effect";

// ────── primitive schemas ──────

/** Tenant slug — lowercase kebab-ish; appears in URLs as `/{slug}/...`. */
const SlugSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]*$/, {
    message: () => "slug must be lowercase a-z, digits, dashes; starting with a letter",
  }),
  Schema.maxLength(40),
);

/** Upstream URL — must be https:// (we do not proxy plaintext). */
const UpstreamUrlSchema = Schema.String.pipe(
  Schema.pattern(/^https:\/\/[^\s/]+/, {
    message: () => "upstream must be an https:// origin (no trailing slash)",
  }),
);

/**
 * Auth kinds the upstream advertises. The pattern is registry-shaped per
 * `[[constructs-mcp-shape]]`: each upstream **announces** its own auth
 * requirements — the gateway transcribes the announcement into the
 * federation manifest. The gateway never holds upstream secrets; callers
 * consume the declaration and supply their own keys.
 */
const AuthKindSchema = Schema.Literal("none", "api-key", "jwt");

/** Operational status — `paused` returns 503 from gateway without removing the tenant from the manifest. */
const TenantStatusSchema = Schema.Literal("live", "paused");

// ────── v0.2 axes ──────
//
// Five new axes — orthogonal to the upstream-metadata fields above. They
// describe how the GATEWAY treats this tenant, not what the upstream
// advertises. See `arch-mcp-federation-v0.2-2026-05-01.md` for the
// invariants and blast-radius reasoning.

/** Discovery scope on federation manifests. */
const VisibilitySchema = Schema.Literal("public", "internal", "unlisted");

/** Gateway access mode — orthogonal to `auth` (which describes the upstream). */
const AccessSchema = Schema.Literal("open", "allowlist", "api-key", "x402");

/** MCP capabilities supported by this tenant (per the MCP spec). */
const CapabilitySchema = Schema.Literal("tools", "resources", "prompts", "sampling", "logging");

/** Pricing model. v1 supports declarative pricing; payment proof lands in Phase 6. */
const PricingModelSchema = Schema.Literal("free", "per-call", "subscription");

const PricingSchema = Schema.Struct({
  model: PricingModelSchema,
  unitUsd: Schema.optional(Schema.Number),
  description: Schema.String.pipe(Schema.maxLength(200)),
}).annotations({
  identifier: "Pricing",
  description: "Pricing declaration; free is the v1 default for first-party tenants",
});

const OwnerSchema = Schema.Struct({
  handle: Schema.String.pipe(Schema.maxLength(64)),
  contact: Schema.String.pipe(Schema.maxLength(200)),
}).annotations({
  identifier: "Owner",
  description: "Owner contact (used when partner-submitted tenants land via PR)",
});

// ────── tenant schema ──────

/**
 * One tenant row. Field comments propagate into the JSON Schema export
 * via `description` — partner authors see them in their tooling.
 */
export const TenantSchema = Schema.Struct({
  slug: SlugSchema.annotations({ description: "Path slug appearing in URLs as /{slug}/..." }),
  name: Schema.String.pipe(Schema.maxLength(80)).annotations({
    description: "Human-readable name (federation index + manifest)",
  }),
  description: Schema.String.pipe(Schema.maxLength(280)).annotations({
    description: "Short description of what the MCP serves (≤280 chars)",
  }),
  publisher: Schema.String.pipe(Schema.maxLength(80)).annotations({
    description: "Org/author publishing the upstream MCP",
  }),
  upstream: UpstreamUrlSchema.annotations({
    description: "Origin of the upstream service (https://, no trailing slash)",
  }),
  auth: AuthKindSchema.annotations({
    description: "Auth kind the upstream advertises (registry declaration — caller composes its request from this)",
  }),
  authHeader: Schema.optional(Schema.String.pipe(Schema.maxLength(64))).annotations({
    description:
      "Wire-level header name the upstream expects when `auth !== 'none'` (e.g. `X-MCP-Key`, `Authorization`). Surfaces in the federation manifest so callers know what to send. Gateway forwards the header intact; the secret value is the caller's concern.",
  }),
  documentation: Schema.optional(Schema.String).annotations({
    description: "Documentation URL (repo, README, or live docs)",
  }),
  status: TenantStatusSchema.annotations({
    description: "Operational status — `paused` returns 503 without removing the tenant from the manifest",
  }),
  // ── v0.2 axes ──
  visibility: VisibilitySchema.annotations({
    description:
      "Discovery scope — `public` appears in /federation.json; `internal` only in the auth-gated /internal/federation.json; `unlisted` never appears in any manifest",
  }),
  access: AccessSchema.annotations({
    description:
      "Gateway access mode — `open` admits all callers; `allowlist`/`api-key` require a bearer matching `TENANT_{SLUG_UPPER}_API_KEY`; `x402` returns 402 until payment-proof verification ships in Phase 6",
  }),
  capabilities: Schema.Array(CapabilitySchema).annotations({
    description: "MCP capabilities the tenant exposes (tools/resources/prompts/sampling/logging) — manual declaration; auto-detection deferred",
  }),
  pricing: Schema.optional(PricingSchema).annotations({
    description: "Pricing declaration; absent means undeclared (caller treats as opaque)",
  }),
  owner: Schema.optional(OwnerSchema).annotations({
    description: "Owner contact for partner-submitted tenants; first-party tenants may omit (`publisher` suffices)",
  }),
}).annotations({
  identifier: "Tenant",
  description: "One MCP tenant served by the federation gateway",
});

/** Static TS type derived from the Schema — single source of truth. */
export type Tenant = Schema.Schema.Type<typeof TenantSchema>;

/** Authoritative array schema (used by decode-at-boot + JSON schema export). */
export const TenantsSchema = Schema.Array(TenantSchema).annotations({
  identifier: "Tenants",
  description: "Federation gateway tenant routing table",
});

// ────── decode at module load ──────

/**
 * Raw config — the data the operator/partner edits. Stays a plain JS array
 * so it diffs cleanly in PRs. The decode step on the next line ensures
 * any change here is type-checked + runtime-validated before the gateway
 * boots.
 */
const RAW_TENANTS: ReadonlyArray<unknown> = [
  {
    slug: "codex",
    name: "Mibera Codex",
    description:
      "Anti-hallucination lookup MCP for Mibera lore — zones, archetypes, factors, grails, miberas. Read by narrative bots and operator harnesses.",
    publisher: "0xHoneyJar",
    upstream: "https://codex-mcp-production.up.railway.app",
    auth: "none",
    documentation: "https://codex.0xhoneyjar.xyz",
    status: "live",
    // v0.2 — explicit defaults (codex is the public, free, read-only canon)
    visibility: "public",
    access: "open",
    capabilities: ["tools"],
    pricing: { model: "free", description: "free as in libre — read-only canon" },
    owner: { handle: "0xHoneyJar", contact: "https://github.com/0xHoneyJar" },
  },
  {
    slug: "score",
    name: "Score Mibera",
    description:
      "Factor metadata + behavioral signals from score-api. Zone digests, top movers, narrative shape. Internal — gated by API key for known callers.",
    publisher: "0xHoneyJar",
    upstream: "https://score-api-production.up.railway.app",
    auth: "api-key",
    authHeader: "X-MCP-Key",
    documentation: "https://github.com/0xHoneyJar/score-mibera",
    status: "live",
    visibility: "internal",
    access: "api-key",
    capabilities: ["tools"],
    pricing: { model: "free", description: "free for known callers" },
    owner: { handle: "0xHoneyJar", contact: "https://github.com/0xHoneyJar" },
  },
];

/**
 * Decode-at-boot. `decodeUnknownSync` throws a `ParseError` with a
 * structured message if anything is malformed. The thrown error
 * crashes the Node process at module load, which is what we want —
 * a misconfigured gateway should refuse to start.
 */
export const TENANTS: ReadonlyArray<Tenant> = Schema.decodeUnknownSync(TenantsSchema)(
  RAW_TENANTS,
);

export function findTenant(slug: string): Tenant | undefined {
  return TENANTS.find((t) => t.slug === slug);
}
