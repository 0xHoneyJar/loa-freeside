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

// Greenlit COLLECTION_REGISTRY — 17 verified erc721 collections across chains 1/10/8453/42161/80094
// (grimoires/loa/context/2026-07-10-shadow-audit-collection-registry.grounded.md). Keys are
// `<chainId>/<lowercase-address>`. Public config (contract addresses), so a literal, not a secret.
const COLLECTION_REGISTRY = {
  "1/0xa20cf9b0874c3e46b344deaeea9c2e0c3e1db37d": { collection: "HoneyJar1", standard: "erc721" },
  "1/0x3f4dd25ba6fb6441bfd1a869cbda6a511966456d": { collection: "HoneyJar2", standard: "erc721" },
  "1/0x49f3915a52e137e597d6bf11c73e78c68b082297": { collection: "HoneyJar3", standard: "erc721" },
  "1/0x0b820623485dcfb1c40a70c55755160f6a42186d": { collection: "HoneyJar4", standard: "erc721" },
  "1/0x39eb35a84752b4bd3459083834af1267d276a54c": { collection: "HoneyJar5", standard: "erc721" },
  "1/0x98dc31a9648f04e23e4e36b0456d1951531c2a05": { collection: "HoneyJar6", standard: "erc721" },
  "1/0xcb0477d1af5b8b05795d89d59f4667b59eae9244": { collection: "Honeycomb", standard: "erc721" },
  "42161/0x1b2751328f41d1a0b91f3710edcd33e996591b72": { collection: "HoneyJar2", standard: "erc721" },
  "10/0xe1d16cc75c9f39a2e0f5131eb39d4b634b23f301": { collection: "HoneyJar4", standard: "erc721" },
  "8453/0xbad7b49d985bbfd3a22706c447fb625a28f048b4": { collection: "HoneyJar5", standard: "erc721" },
  "80094/0xedc5dfd6f37464cc91bbce572b6fe2c97f1bc7b3": { collection: "HoneyJar1", standard: "erc721" },
  "80094/0x1c6c24cac266c791c4ba789c3ec91f04331725bd": { collection: "HoneyJar2", standard: "erc721" },
  "80094/0xf1e4a550772fabfc35b28b51eb8d0b6fcd1c4878": { collection: "HoneyJar3", standard: "erc721" },
  "80094/0xdb602ab4d6bd71c8d11542a9c8c936877a9a4f45": { collection: "HoneyJar4", standard: "erc721" },
  "80094/0x0263728e7f59f315c17d3c180aeade027a375f17": { collection: "HoneyJar5", standard: "erc721" },
  "80094/0xb62a9a21d98478f477e134e175fd2003c15cb83a": { collection: "HoneyJar6", standard: "erc721" },
  "80094/0x886d2176d899796cd1affa07eff07b9b2b80f1be": { collection: "Honeycomb", standard: "erc721" },
};

export default defineRailway(() => {
  const database = postgres("shadow-audit-postgres");
  const audit = service("shadow-audit-api", {
    // Build context = repo root (no rootDirectory) — the Dockerfile needs core+adapters+protocol siblings.
    // TEMPORARY branch: the current shadow-audit (incl. §12.3 hardening + S1-T4 ingestion) lives on
    // feat/shadow-audit-mvp, NOT yet on main (main is 42 mixed-domain commits behind ride-refresh). Deploy
    // from the feature branch to get the real box live now; move back to "main" once the shadow-audit
    // lineage is merged cleanly (a scoped merge, NOT a blind 42-commit admin-merge).
    source: github("0xHoneyJar/loa-freeside", { branch: "feat/shadow-audit-mvp" }),
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
