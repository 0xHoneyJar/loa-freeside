import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  acquirePublicAuthorizationLease,
  authorizePublicOperation,
  AuthorizationDeniedError,
  decodeFixtureProjectionBundle,
  decodePublicAuthorizationScope,
  fixtureProjectionFromBundle,
  PUBLIC_AUTHORIZATION_LEASE_MAX_MS,
  resolutionScopeToPublic,
} from "../index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/acl");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

const NOW = 1_752_768_000_000;

function baselineProjections() {
  const bundle = Effect.runSync(decodeFixtureProjectionBundle(readJson("projection-baseline.valid.json")));
  return fixtureProjectionFromBundle(bundle, NOW);
}

describe("public authorization protocol (CR-007A)", () => {
  it("decodes public authorization scopes strictly", () => {
    const scope = Effect.runSync(decodePublicAuthorizationScope(readJson("scope-report-create.valid.json")));
    expect(scope.permission).toBe("report:create");
  });

  it("acquires a resolution create lease for an authorized subject", () => {
    const { membership, grants } = baselineProjections();
    const scope = Effect.runSync(decodePublicAuthorizationScope(readJson("scope-report-create.valid.json")));
    const lease = acquirePublicAuthorizationLease({
      operation: { resource: "resolution", action: "create" },
      scope,
      membership,
      grants,
      nowMs: NOW,
    });
    expect(lease.resource).toBe("resolution");
    expect(lease.expires_at_unix_ms - lease.issued_at_unix_ms).toBe(
      PUBLIC_AUTHORIZATION_LEASE_MAX_MS,
    );
  });

  it("denies cross-community scope tampering", () => {
    const { membership, grants } = baselineProjections();
    const scope = Effect.runSync(decodePublicAuthorizationScope(readJson("scope-report-create.valid.json")));
    expect(() =>
      authorizePublicOperation({
        operation: { resource: "resolution", action: "create" },
        scope,
        membership,
        grants,
        nowMs: NOW,
        authoritativeCommunityRef: "community-beta",
      }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("denies cross-user replay (subject mismatch)", () => {
    const { membership, grants } = baselineProjections();
    const scope = Effect.runSync(decodePublicAuthorizationScope(readJson("scope-report-create.valid.json")));
    expect(() =>
      authorizePublicOperation({
        operation: { resource: "report_order", action: "detail" },
        scope,
        membership,
        grants,
        nowMs: NOW,
        authoritativeSubjectId: "subject-bob",
      }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("denies revoked membership", () => {
    const bundle = Effect.runSync(decodeFixtureProjectionBundle(readJson("projection-baseline.valid.json")));
    const revoked = {
      ...bundle,
      memberships: bundle.memberships.map((m) =>
        m.subject_id === "subject-alice" ? { ...m, active: false } : m,
      ),
    };
    const { membership, grants } = fixtureProjectionFromBundle(revoked, NOW);
    const scope = Effect.runSync(decodePublicAuthorizationScope(readJson("scope-report-create.valid.json")));
    expect(() =>
      authorizePublicOperation({
        operation: { resource: "resolution", action: "create" },
        scope,
        membership,
        grants,
        nowMs: NOW,
      }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("denies permission revoked while membership remains", () => {
    const bundle = Effect.runSync(decodeFixtureProjectionBundle(readJson("projection-baseline.valid.json")));
    const revokedGrant = {
      ...bundle,
      grants: bundle.grants.map((g) =>
        g.subject_id === "subject-alice" && g.permission === "report:create"
          ? { ...g, active: false }
          : g,
      ),
    };
    const { membership, grants } = fixtureProjectionFromBundle(revokedGrant, NOW);
    const scope = Effect.runSync(decodePublicAuthorizationScope(readJson("scope-report-create.valid.json")));
    expect(() =>
      authorizePublicOperation({
        operation: { resource: "resolution", action: "create" },
        scope,
        membership,
        grants,
        nowMs: NOW,
      }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("bridges CR-006 resolution scopes into public authorization", () => {
    const publicScope = resolutionScopeToPublic({
      schema_version: 1,
      subject_id: "subject-alice",
      community_ref: "community-alpha",
      permission: "report:create",
    });
    expect(publicScope.community_ref).toBe("community-alpha");
  });

  it("rejects resolution scopes missing community_ref", () => {
    expect(() =>
      resolutionScopeToPublic({
        schema_version: 1,
        subject_id: "subject-alice",
        permission: "report:create",
      }),
    ).toThrow(AuthorizationDeniedError);
  });
});
