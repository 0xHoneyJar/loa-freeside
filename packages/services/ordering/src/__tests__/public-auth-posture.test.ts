import { describe, expect, it } from "vitest";
import {
  resolvePublicAuthPosture,
  serviceTokenForPublicAuthMounts,
} from "../public-auth-posture.js";
import { createFixturePublicAuthorizationService } from "../public-authorization-service.js";
import { DEFAULT_BASELINE_FIXTURE } from "../public-authorization-projections.js";
import { AuthorizationDeniedError } from "@freeside/public-authorization-protocol";

describe("resolvePublicAuthPosture", () => {
  it("defaults to fixture in local/dev", () => {
    const p = resolvePublicAuthPosture({ nodeEnv: "development" });
    expect(p.mode).toBe("fixture");
    expect(p.allowFixture).toBe(true);
  });

  it("defaults to disabled when deployed and mode unset", () => {
    const p = resolvePublicAuthPosture({ nodeEnv: "production" });
    expect(p.mode).toBe("disabled");
    expect(p.allowFixture).toBe(false);
  });

  it("allows deployed fixture only with t0_t1 waiver", () => {
    expect(
      resolvePublicAuthPosture({
        mode: "fixture",
        nodeEnv: "production",
      }).allowFixture,
    ).toBe(false);
    expect(
      resolvePublicAuthPosture({
        mode: "fixture",
        fixtureWaiver: "t0_t1",
        railwayEnvironment: "production",
      }).allowFixture,
    ).toBe(true);
  });

  it("refuses identity until CR-007B port exists", () => {
    const p = resolvePublicAuthPosture({ mode: "identity" });
    expect(p.mode).toBe("identity");
    expect(p.allowFixture).toBe(false);
  });
});

describe("serviceTokenForPublicAuthMounts — FR-10a", () => {
  it("refuses when write routes are disabled_no_token", () => {
    expect(serviceTokenForPublicAuthMounts("disabled_no_token", undefined)).toEqual({
      kind: "refuse",
    });
  });

  it("requires token when write posture is token", () => {
    expect(serviceTokenForPublicAuthMounts("token", "secret")).toEqual({
      kind: "token",
      token: "secret",
    });
    expect(serviceTokenForPublicAuthMounts("token", undefined).kind).toBe("refuse");
  });

  it("allows open_dev without token", () => {
    expect(serviceTokenForPublicAuthMounts("open_dev", undefined)).toEqual({
      kind: "open_dev",
    });
  });
});

describe("fixture ACL blast radius", () => {
  it("denies live-shaped CM subject_id under DEFAULT_BASELINE_FIXTURE", () => {
    const auth = createFixturePublicAuthorizationService(
      DEFAULT_BASELINE_FIXTURE,
      () => 1_752_768_000_000,
    );
    expect(() =>
      auth.acquireLease({
        operation: { resource: "report_order", action: "list" },
        scope: {
          schema_version: 1,
          subject_id: "11111111-1111-1111-1111-111111111111",
          community_ref: "mibera",
          permission: "report:read",
        },
        authoritativeCommunityRef: "mibera",
        authoritativeSubjectId: "11111111-1111-1111-1111-111111111111",
      }),
    ).toThrow(AuthorizationDeniedError);
  });
});
