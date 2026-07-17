/**
 * CR-007A deploy posture for public authorization.
 *
 * Fixture ACL (`subject-alice|bob|carol`) must NEVER silently ship as the
 * production Identity projection. Deployed envs default to `disabled` unless
 * an explicit mode + (for fixture) T0/T1 waiver is set.
 *
 *   PUBLIC_AUTH_MODE=fixture|identity|disabled
 *   PUBLIC_AUTH_FIXTURE_WAIVER=t0_t1   # required with mode=fixture when deployed
 */

import type { WriteRoutePosture } from "./composition.js";

export type PublicAuthMode = "fixture" | "identity" | "disabled";

export interface PublicAuthPostureEnv {
  readonly mode?: string;
  readonly fixtureWaiver?: string;
  readonly railwayEnvironment?: string;
  readonly nodeEnv?: string;
}

export interface PublicAuthPosture {
  readonly mode: PublicAuthMode;
  /** True when fixture ACL may be wired into the composition root. */
  readonly allowFixture: boolean;
  /** Why fixture/identity was refused (for logs + healthz). */
  readonly reason: string | null;
}

export function isDeployedEnv(env: {
  railwayEnvironment?: string;
  nodeEnv?: string;
}): boolean {
  return Boolean(env.railwayEnvironment?.trim()) || env.nodeEnv === "production";
}

/**
 * Resolve public-auth mode.
 *
 * | env      | PUBLIC_AUTH_MODE | waiver     | result                         |
 * |----------|------------------|------------|--------------------------------|
 * | local    | unset            | —          | fixture (lab default)          |
 * | deployed | unset            | —          | disabled (fail-closed)         |
 * | deployed | fixture          | t0_t1      | fixture (explicit T0/T1 only)  |
 * | deployed | fixture          | unset/other| disabled                       |
 * | any      | identity         | —          | disabled until CR-007B port    |
 * | any      | disabled         | —          | disabled                       |
 */
export function resolvePublicAuthPosture(env: PublicAuthPostureEnv): PublicAuthPosture {
  const deployed = isDeployedEnv(env);
  const raw = env.mode?.trim().toLowerCase();
  const waiver = env.fixtureWaiver?.trim().toLowerCase();

  if (raw === "disabled") {
    return { mode: "disabled", allowFixture: false, reason: "PUBLIC_AUTH_MODE=disabled" };
  }

  if (raw === "identity") {
    return {
      mode: "identity",
      allowFixture: false,
      reason: "identity projections require CR-007B / live Identity port (not wired)",
    };
  }

  if (raw === "fixture") {
    if (deployed && waiver !== "t0_t1") {
      return {
        mode: "fixture",
        allowFixture: false,
        reason:
          "deployed fixture ACL refused without PUBLIC_AUTH_FIXTURE_WAIVER=t0_t1",
      };
    }
    return {
      mode: "fixture",
      allowFixture: true,
      reason: deployed ? "fixture+t0_t1_waiver" : null,
    };
  }

  if (raw !== undefined && raw.length > 0) {
    return {
      mode: "disabled",
      allowFixture: false,
      reason: `unknown PUBLIC_AUTH_MODE=${raw}`,
    };
  }

  // Unset: lab fixture locally; fail-closed when deployed.
  if (deployed) {
    return {
      mode: "disabled",
      allowFixture: false,
      reason: "deployed default: PUBLIC_AUTH_MODE unset → disabled (set fixture+waiver or identity)",
    };
  }

  return { mode: "fixture", allowFixture: true, reason: null };
}

export function publicAuthPostureFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PublicAuthPosture {
  return resolvePublicAuthPosture({
    mode: env.PUBLIC_AUTH_MODE,
    fixtureWaiver: env.PUBLIC_AUTH_FIXTURE_WAIVER,
    railwayEnvironment: env.RAILWAY_ENVIRONMENT,
    nodeEnv: env.NODE_ENV,
  });
}

/**
 * Bearer posture for CR-007A mounts — FR-10a parity with write routes.
 * When deployed with no SERVICE_TOKEN, never treat unset token as open_dev.
 */
export function serviceTokenForPublicAuthMounts(
  writeRoutes: WriteRoutePosture,
  serviceToken: string | undefined,
): { kind: "open_dev" } | { kind: "token"; token: string } | { kind: "refuse" } {
  if (writeRoutes === "disabled_no_token") return { kind: "refuse" };
  if (writeRoutes === "token") {
    if (!serviceToken) return { kind: "refuse" };
    return { kind: "token", token: serviceToken };
  }
  return { kind: "open_dev" };
}
