/**
 * S2-T1 (SDD §8, G-1) — Railway Infrastructure-as-Code for `shadow-audit-api`.
 *
 * Grounded against docs.railway.com/infrastructure-as-code (the `railway/iac` TypeScript DSL:
 * defineRailway / project / service / github / preserve). This file does what config-as-code CANNOT:
 * declare the service, pin the GitHub source, and set the env. The Dockerfile BUILD + deploy settings
 * (healthcheck, restart) live in `railway.json` at repo root — the split the shadow-audit Dockerfile
 * comment itself endorses ("rely on railway.toml's dockerfilePath relative to repo root").
 *
 * Build context = repo ROOT (github source with NO rootDirectory), because the Dockerfile stages the
 * transitive file: tree packages/core ← packages/adapters ← packages/services/shadow-audit (+ protocol).
 *
 * ⚠️ RAILWAY IaC IS DECLARATIVE — this file is the COMPLETE desired state of its LINKED project. Applying
 * it to a project that holds OTHER services DELETES every resource not declared here. `railway config plan`
 * on 2026-07-10 was linked to the `ordering-service` project and planned "1 to add, 3 to DESTROY" (would
 * have deleted ordering-service + its Postgres + fulfillment-orchestrator). shadow-audit-api MUST get its
 * OWN Railway project. Operator: create/link a dedicated project (`railway link` → new/empty project), then
 * re-plan — a correct plan reads "1 to add, 0 to destroy".
 *
 * DEPLOY IS OPERATOR-GATED (SDD §8 / NFR-2):
 *   railway config plan --json --detailed-exit-code   # read-only — validates against Railway's live schema
 *   → operator reviews the EXACT plan (ZERO destroys) →
 *   railway config apply                               # NEVER --yes / --confirm-destructive from the agent
 *
 * Secrets (SHADOW_AUDIT_API_KEY, ROLE_SNAPSHOT_INGEST_TOKEN, CTA_*) use preserve() — set once in the
 * Railway dashboard/secret store, never written into source. `railway config plan` shows them as «hidden».
 */
import { defineRailway, project, service, github, postgres, preserve } from "railway/iac";

export default defineRailway(() => {
  const database = postgres("shadow-audit-postgres");
  const audit = service("shadow-audit-api", {
    // Build context = repo root (no rootDirectory) — the Dockerfile needs core+adapters+protocol siblings.
    // Production IaC must outlive any feature branch. This PR carries the coherent shadow-audit lineage
    // onto main, so future Railway builds follow the durable production branch.
    source: github("0xHoneyJar/loa-freeside", { branch: "main" }),
    // Dockerfile build. CONFIRMED against the SDK types (railway/dist: `build?: string | BuildConfig`;
    // BuildConfig.builder ∈ "DOCKERFILE"|… ; BuildConfig.dockerfilePath) AND a successful `railway config
    // plan`. dockerfilePath is relative to the repo-root build context.
    build: { builder: "DOCKERFILE", dockerfilePath: "packages/services/shadow-audit/Dockerfile" },
    // /healthz is the open liveness route (server.ts:134); everything else is X-API-Key gated.
    healthcheck: "/healthz",
    healthcheckTimeout: 30,
    env: {
      // arrakis-7mtwa is a persistence-only apply. Preserve the live public configuration so creating the
      // database cannot also redeploy a registry/RPC/community change. Reconcile those literals separately
      // after grounding their current live values; they are not part of this bug's mutation boundary.
      OPERATED_COMMUNITIES: preserve(),
      COLLECTION_REGISTRY: preserve(),
      RPC_URL_1: preserve(),
      RPC_URL_10: preserve(),
      RPC_URL_8453: preserve(),
      RPC_URL_42161: preserve(),
      RPC_URL_80094: preserve(),
      AUDIT_K: preserve(),
      // arrakis-7mtwa: the container filesystem is ephemeral. Role snapshots live in the project-managed
      // Postgres resource so a deploy replacement cannot silently erase the latest export.
      ROLE_SNAPSHOT_STORE: "postgres",
      DATABASE_URL: database.env.DATABASE_URL,
      // Retain the old dashboard value during migration. The postgres backend ignores it, but preserving it
      // keeps this bounded change non-destructive and leaves an operator-controlled rollback path.
      ROLE_SNAPSHOT_DIR: preserve(),
      // Secrets — set once in Railway, never in source. preserve() keeps the dashboard value.
      SHADOW_AUDIT_API_KEY: preserve(),
      ROLE_SNAPSHOT_INGEST_TOKEN: preserve(),
      CTA_PRODUCT: preserve(),
      CTA_CONVERSATION: preserve(),
    },
  });

  return project("shadow-audit-api", { resources: [database, audit] });
});
