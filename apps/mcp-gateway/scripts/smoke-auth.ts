/**
 * Pure unit smoke for `src/auth.ts` — no HTTP, no dev server.
 *
 * Exercises `checkAccess` across all four `tenant.access` modes by
 * constructing a minimal mock Hono Context. Verifies:
 *
 *  - `open`       → always allowed (no auth required)
 *  - `api-key`    → 401 without bearer, 401 with wrong bearer, 200 with correct bearer, 401 when env unset (fail-closed)
 *  - `allowlist`  → same shape as api-key (v1)
 *  - `x402`       → 402 always (Phase 6 will wire payment proof)
 *
 * Run:  `pnpm tsx scripts/smoke-auth.ts`
 */

import type { Context } from "hono";
import { checkAccess } from "../src/auth.js";
import type { Tenant } from "../src/tenants.js";

function mkContext(authHeader?: string): Context {
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === "authorization" ? authHeader : undefined,
    },
  } as unknown as Context;
}

function mkTenant(overrides: Partial<Tenant>): Tenant {
  return {
    slug: "test",
    name: "Test",
    description: "test",
    publisher: "test",
    upstream: "https://example.com",
    auth: "none",
    documentation: undefined,
    status: "live",
    visibility: "internal",
    access: "open",
    capabilities: ["tools"],
    pricing: undefined,
    owner: undefined,
    ...overrides,
  } as Tenant;
}

type Case = {
  name: string;
  tenant: Tenant;
  authHeader?: string;
  envSetup?: () => void;
  envTeardown?: () => void;
  expect: { allowed: boolean; status?: number };
};

const cases: ReadonlyArray<Case> = [
  // ── open ──
  {
    name: "open · no auth → allowed",
    tenant: mkTenant({ access: "open" }),
    expect: { allowed: true },
  },
  {
    name: "open · with bogus bearer → allowed (open ignores auth)",
    tenant: mkTenant({ access: "open" }),
    authHeader: "Bearer anything",
    expect: { allowed: true },
  },

  // ── api-key (env unset = fail-closed) ──
  {
    name: "api-key · env unset · with bearer → 401 (fail-closed)",
    tenant: mkTenant({ slug: "fake", access: "api-key" }),
    authHeader: "Bearer some-key",
    envSetup: () => {
      delete process.env.TENANT_FAKE_API_KEY;
    },
    expect: { allowed: false, status: 401 },
  },

  // ── api-key (env set) ──
  {
    name: "api-key · env set · no bearer → 401",
    tenant: mkTenant({ slug: "fake", access: "api-key" }),
    envSetup: () => {
      process.env.TENANT_FAKE_API_KEY = "secret-key";
    },
    expect: { allowed: false, status: 401 },
  },
  {
    name: "api-key · env set · wrong bearer → 401",
    tenant: mkTenant({ slug: "fake", access: "api-key" }),
    authHeader: "Bearer wrong",
    envSetup: () => {
      process.env.TENANT_FAKE_API_KEY = "secret-key";
    },
    expect: { allowed: false, status: 401 },
  },
  {
    name: "api-key · env set · correct bearer → allowed",
    tenant: mkTenant({ slug: "fake", access: "api-key" }),
    authHeader: "Bearer secret-key",
    envSetup: () => {
      process.env.TENANT_FAKE_API_KEY = "secret-key";
    },
    expect: { allowed: true },
  },
  {
    name: "api-key · slug with dashes uses underscores in env name",
    tenant: mkTenant({ slug: "freeside-auth", access: "api-key" }),
    authHeader: "Bearer dash-key",
    envSetup: () => {
      process.env.TENANT_FREESIDE_AUTH_API_KEY = "dash-key";
    },
    expect: { allowed: true },
  },

  // ── allowlist (same as api-key in v1) ──
  {
    name: "allowlist · env set · correct bearer → allowed",
    tenant: mkTenant({ slug: "fake", access: "allowlist" }),
    authHeader: "Bearer secret-key",
    envSetup: () => {
      process.env.TENANT_FAKE_API_KEY = "secret-key";
    },
    expect: { allowed: true },
  },
  {
    name: "allowlist · env set · wrong bearer → 401",
    tenant: mkTenant({ slug: "fake", access: "allowlist" }),
    authHeader: "Bearer wrong",
    envSetup: () => {
      process.env.TENANT_FAKE_API_KEY = "secret-key";
    },
    expect: { allowed: false, status: 401 },
  },

  // ── x402 ──
  {
    name: "x402 · no bearer → 402",
    tenant: mkTenant({ access: "x402" }),
    expect: { allowed: false, status: 402 },
  },
  {
    name: "x402 · with bearer → still 402 (payment-proof not wired)",
    tenant: mkTenant({ access: "x402" }),
    authHeader: "Bearer anything",
    expect: { allowed: false, status: 402 },
  },
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  c.envSetup?.();
  const ctx = mkContext(c.authHeader);
  const result = checkAccess(ctx, c.tenant);

  const ok =
    result.allowed === c.expect.allowed &&
    (c.expect.status === undefined ||
      (!result.allowed && result.status === c.expect.status));

  if (ok) {
    passed += 1;
    console.log(`✓ ${c.name}`);
  } else {
    failed += 1;
    console.log(`✗ ${c.name}`);
    console.log(`    expected: ${JSON.stringify(c.expect)}`);
    console.log(`    got:      ${JSON.stringify(result)}`);
  }

  c.envTeardown?.();
}

console.log("");
console.log(`──── ${passed}/${passed + failed} passed`);

if (failed > 0) {
  process.exit(1);
}
