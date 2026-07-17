/**
 * Unit tests · src/credentials-resolver.ts
 *
 * Per Sprint 3 AC-4 + AC-5 + Security Considerations:
 *   - authKind=none → resolved with empty header (no-op for proxy)
 *   - authKind=api-key with all wiring + env present → resolved with header+value
 *   - authKind=api-key but missing env var → fail-closed with clear reason
 *   - authKind=api-key with no header/credentials_ref → fail-closed
 *   - credentials_ref.type=sops/doppler → fail-closed (v0.4 territory)
 *   - resolved value never logged (visual inspection of reason strings)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveUpstreamCredential } from "../src/credentials-resolver.js";
import type { ResolvedTenant } from "../src/beacon-resolver.js";

// ── fixtures ──

function baseTenant(overrides: Partial<ResolvedTenant> = {}): ResolvedTenant {
  return {
    slug: "test",
    upstream: "https://test-upstream.example.com",
    visibility: "public",
    access: "open",
    status: "live",
    name: "Test",
    description: "Test tenant",
    publisher: "0xHoneyJar",
    authKind: "none",
    capabilities: ["tools"],
    beaconSource: "fresh",
    beaconAgeSec: 5,
    ...overrides,
  };
}

// ── authKind: none ──

test("authKind=none returns resolved=true with empty header (no-op)", () => {
  const cred = resolveUpstreamCredential(baseTenant({ authKind: "none" }));
  assert.equal(cred.resolved, true);
  if (cred.resolved) {
    assert.equal(cred.header, "");
    assert.equal(cred.value, "");
  }
});

// ── authKind: api-key ──

test("authKind=api-key with full wiring + env present resolves", () => {
  const ENV_KEY = "MCP_TEST_UPSTREAM_KEY_HAPPY";
  process.env[ENV_KEY] = "sk-test-secret-value-1234";
  try {
    const cred = resolveUpstreamCredential(
      baseTenant({
        authKind: "api-key",
        authHeader: "X-MCP-Key",
        credentialsRef: { type: "railway-secret", key: ENV_KEY },
      }),
    );
    assert.equal(cred.resolved, true);
    if (cred.resolved) {
      assert.equal(cred.header, "X-MCP-Key");
      assert.equal(cred.value, "sk-test-secret-value-1234");
    }
  } finally {
    delete process.env[ENV_KEY];
  }
});

test("authKind=api-key with env-var type also resolves via process.env", () => {
  const ENV_KEY = "MCP_TEST_UPSTREAM_KEY_ENVVAR";
  process.env[ENV_KEY] = "envvar-value";
  try {
    const cred = resolveUpstreamCredential(
      baseTenant({
        authKind: "api-key",
        authHeader: "Authorization",
        credentialsRef: { type: "env-var", key: ENV_KEY },
      }),
    );
    assert.equal(cred.resolved, true);
    if (cred.resolved) {
      assert.equal(cred.value, "envvar-value");
    }
  } finally {
    delete process.env[ENV_KEY];
  }
});

test("authKind=api-key but missing env var fails-closed with clear reason", () => {
  const cred = resolveUpstreamCredential(
    baseTenant({
      slug: "missingenv",
      authKind: "api-key",
      authHeader: "X-MCP-Key",
      credentialsRef: { type: "railway-secret", key: "DEFINITELY_NOT_SET_XYZ_42" },
    }),
  );
  assert.equal(cred.resolved, false);
  if (!cred.resolved) {
    assert.match(cred.reason, /tenant_misconfigured/);
    assert.match(cred.reason, /missingenv/);
    assert.match(cred.reason, /DEFINITELY_NOT_SET_XYZ_42/);
  }
});

test("authKind=api-key without authHeader fails-closed", () => {
  const cred = resolveUpstreamCredential(
    baseTenant({
      slug: "noheader",
      authKind: "api-key",
      authHeader: undefined,
      credentialsRef: { type: "railway-secret", key: "ANY_KEY" },
    }),
  );
  assert.equal(cred.resolved, false);
  if (!cred.resolved) {
    assert.match(cred.reason, /missing header or credentials_ref/);
  }
});

test("authKind=api-key without credentialsRef fails-closed", () => {
  const cred = resolveUpstreamCredential(
    baseTenant({
      slug: "noref",
      authKind: "api-key",
      authHeader: "X-MCP-Key",
      credentialsRef: undefined,
    }),
  );
  assert.equal(cred.resolved, false);
  if (!cred.resolved) {
    assert.match(cred.reason, /missing header or credentials_ref/);
  }
});

// ── unsupported types ──

test("credentials_ref.type=sops fails-closed with v0.3 deferral message", () => {
  const cred = resolveUpstreamCredential(
    baseTenant({
      authKind: "api-key",
      authHeader: "X-MCP-Key",
      credentialsRef: { type: "sops", key: "SOPS_KEY" },
    }),
  );
  assert.equal(cred.resolved, false);
  if (!cred.resolved) {
    assert.match(cred.reason, /not supported in v0\.3/);
    assert.match(cred.reason, /sops/);
  }
});

test("credentials_ref.type=doppler fails-closed", () => {
  const cred = resolveUpstreamCredential(
    baseTenant({
      authKind: "api-key",
      authHeader: "X-MCP-Key",
      credentialsRef: { type: "doppler", key: "DOPPLER_KEY" },
    }),
  );
  assert.equal(cred.resolved, false);
  if (!cred.resolved) {
    assert.match(cred.reason, /not supported in v0\.3/);
  }
});

// ── secret never echoed in reason ──

test("failure reasons never include the credential value (only env-var name)", () => {
  const ENV_KEY = "MCP_TEST_UPSTREAM_KEY_LEAK_CHECK";
  process.env[ENV_KEY] = "super-secret-do-not-leak";
  try {
    // The success path returns the value · failure paths must not echo it.
    // We trigger a failure by passing an unsupported type with a real-ish env.
    const cred = resolveUpstreamCredential(
      baseTenant({
        authKind: "api-key",
        authHeader: "X-MCP-Key",
        credentialsRef: { type: "sops", key: ENV_KEY },
      }),
    );
    assert.equal(cred.resolved, false);
    if (!cred.resolved) {
      assert.ok(
        !cred.reason.includes("super-secret-do-not-leak"),
        `reason should not echo secret value: ${cred.reason}`,
      );
    }
  } finally {
    delete process.env[ENV_KEY];
  }
});
