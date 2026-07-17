/**
 * HTTP edge for CR-006 collection resolutions.
 *
 *   POST /v1/collection-resolutions
 *   POST /v1/collection-resolutions/:id/confirm
 *   POST /v1/collection-resolutions/:id/refresh
 *
 * Auth: Bearer SERVICE_TOKEN (Dashboard BFF). Authorization scope is taken from
 * the BFF body and re-checked against command community_ref by the service.
 */

import { Hono, type Context } from "hono";
import {
  COLLECTION_RESOLUTION_SCHEMA_VERSION,
  AuthorizationScopeMismatchError,
  ConcurrentConfirmationError,
  ConfirmationVersionConflictError,
  ContractIntegrityError,
  IdempotencyConflictError,
  ImmutableRequestMismatchError,
  ResolutionExpiredError,
  ResolutionNotFoundError,
  SelectionRejectedError,
  type ResolutionPublicProjection,
} from "@freeside/collection-resolution-protocol";
import {
  CollectionResolutionService,
  type SonarResolveProbePort,
} from "./resolution-service.js";
import type { ResolutionStore } from "./resolution-store.js";
import { SonarResolveProbeUnavailableError } from "./sonar-resolve-probe-client.js";

export interface ResolutionHttpDeps {
  readonly store: ResolutionStore;
  readonly sonar: SonarResolveProbePort;
  readonly serviceToken?: string;
  readonly service?: CollectionResolutionService;
}

type OrderingErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "idempotency_conflict"
  | "resolution_expired"
  | "selection_rejected"
  | "digest_mismatch"
  | "confirmation_version_conflict"
  | "concurrent_confirmation"
  | "authorization_scope_mismatch"
  | "immutable_request_mismatch"
  | "rate_limited"
  | "unavailable";

const ERROR_STATUS: Record<OrderingErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  idempotency_conflict: 409,
  resolution_expired: 409,
  selection_rejected: 409,
  digest_mismatch: 409,
  confirmation_version_conflict: 409,
  concurrent_confirmation: 409,
  authorization_scope_mismatch: 403,
  immutable_request_mismatch: 403,
  rate_limited: 429,
  unavailable: 503,
};

function errorBody(
  code: OrderingErrorCode,
  extra?: { current_confirmation_version?: number; retry_after_seconds?: number },
) {
  return {
    schema_version: COLLECTION_RESOLUTION_SCHEMA_VERSION,
    code,
    ...(extra?.current_confirmation_version !== undefined
      ? { current_confirmation_version: extra.current_confirmation_version }
      : {}),
    ...(extra?.retry_after_seconds !== undefined
      ? { retry_after_seconds: extra.retry_after_seconds }
      : {}),
  };
}

function mapError(err: unknown): { status: number; body: ReturnType<typeof errorBody> } {
  if (err instanceof SonarResolveProbeUnavailableError) {
    return { status: 503, body: errorBody("unavailable") };
  }
  if (err instanceof IdempotencyConflictError) {
    return { status: ERROR_STATUS.idempotency_conflict, body: errorBody("idempotency_conflict") };
  }
  if (err instanceof ResolutionNotFoundError) {
    return { status: ERROR_STATUS.not_found, body: errorBody("not_found") };
  }
  if (err instanceof ResolutionExpiredError) {
    return { status: ERROR_STATUS.resolution_expired, body: errorBody("resolution_expired") };
  }
  if (err instanceof SelectionRejectedError) {
    const code =
      err.reason === "client_digest_forgery" ? "digest_mismatch" : "selection_rejected";
    return { status: ERROR_STATUS[code], body: errorBody(code) };
  }
  if (err instanceof ConfirmationVersionConflictError) {
    return {
      status: ERROR_STATUS.confirmation_version_conflict,
      body: errorBody("confirmation_version_conflict", {
        current_confirmation_version: err.current_confirmation_version,
      }),
    };
  }
  if (err instanceof ConcurrentConfirmationError) {
    return {
      status: ERROR_STATUS.concurrent_confirmation,
      body: errorBody("concurrent_confirmation", {
        current_confirmation_version: err.current_confirmation_version,
      }),
    };
  }
  if (err instanceof AuthorizationScopeMismatchError) {
    return {
      status: ERROR_STATUS.authorization_scope_mismatch,
      body: errorBody("authorization_scope_mismatch"),
    };
  }
  if (err instanceof ImmutableRequestMismatchError) {
    return {
      status: ERROR_STATUS.immutable_request_mismatch,
      body: errorBody("immutable_request_mismatch"),
    };
  }
  if (err instanceof ContractIntegrityError) {
    return { status: ERROR_STATUS.invalid_request, body: errorBody("invalid_request") };
  }
  if (
    err instanceof Error &&
    (err.name === "ParseError" ||
      err.message.includes("ParseError") ||
      err.message.includes("is missing") ||
      err.message.includes("Expected"))
  ) {
    return { status: ERROR_STATUS.invalid_request, body: errorBody("invalid_request") };
  }
  return { status: 503, body: errorBody("unavailable") };
}

function requireBearer(c: Context, token: string | undefined): boolean {
  if (!token) return true;
  return c.req.header("authorization") === `Bearer ${token}`;
}

async function readCommandBody(
  c: Context,
): Promise<
  | { ok: true; command: unknown; authorization_scope: unknown }
  | { ok: false; response: Response }
> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json(errorBody("invalid_request"), 400),
    };
  }
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      response: c.json(errorBody("invalid_request"), 400),
    };
  }
  const body = raw as { command?: unknown; authorization_scope?: unknown };
  if (!body.command || !body.authorization_scope) {
    return {
      ok: false,
      response: c.json(errorBody("invalid_request"), 400),
    };
  }
  return {
    ok: true,
    command: body.command,
    authorization_scope: body.authorization_scope,
  };
}

export function mountCollectionResolutionRoutes(
  app: Hono,
  deps: ResolutionHttpDeps,
): void {
  const service =
    deps.service ??
    new CollectionResolutionService({ store: deps.store, sonar: deps.sonar });

  const respond = async (
    c: Context,
    run: () => Promise<ResolutionPublicProjection>,
  ) => {
    try {
      const projection = await run();
      return c.json(projection, 200, { "Cache-Control": "no-store" });
    } catch (err) {
      const mapped = mapError(err);
      return c.json(mapped.body, mapped.status as 400);
    }
  };

  app.post("/v1/collection-resolutions", async (c) => {
    if (!requireBearer(c, deps.serviceToken)) {
      return c.json(errorBody("unauthorized"), 401);
    }
    const parsed = await readCommandBody(c);
    if (!parsed.ok) return parsed.response;
    return respond(c, () =>
      service.create(parsed.command as never, parsed.authorization_scope as never),
    );
  });

  app.post("/v1/collection-resolutions/:id/confirm", async (c) => {
    if (!requireBearer(c, deps.serviceToken)) {
      return c.json(errorBody("unauthorized"), 401);
    }
    const parsed = await readCommandBody(c);
    if (!parsed.ok) return parsed.response;
    return respond(c, () =>
      service.confirm(
        c.req.param("id"),
        parsed.command as never,
        parsed.authorization_scope as never,
      ),
    );
  });

  app.post("/v1/collection-resolutions/:id/refresh", async (c) => {
    if (!requireBearer(c, deps.serviceToken)) {
      return c.json(errorBody("unauthorized"), 401);
    }
    const parsed = await readCommandBody(c);
    if (!parsed.ok) return parsed.response;
    return respond(c, () =>
      service.refresh(
        c.req.param("id"),
        parsed.command as never,
        parsed.authorization_scope as never,
      ),
    );
  });
}
