/**
 * CR-007A capability-demand HTTP edge (authorization contract; CR-208 owns full lifecycle).
 *
 *   POST   /v1/capability-demands
 *   GET    /v1/capability-demands
 *   GET    /v1/capability-demands/:demand_id
 *   DELETE /v1/capability-demands/:demand_id
 *
 * Auth: Bearer SERVICE_TOKEN (Dashboard BFF) + authorization_scope recheck.
 * Public projections expose no subscriber counts or cross-tenant demand.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";
import type { PublicAuthorizationService } from "./public-authorization-service.js";
import {
  noStoreHeaders,
  readAuthorizedBody,
  requireServiceBearer,
} from "./public-authorization-http.js";
import {
  type CapabilityDemandStore,
  toPublicCapabilityDemandProjection,
} from "./capability-demand-store.js";

export interface CapabilityDemandHttpDeps {
  readonly store: CapabilityDemandStore;
  readonly auth: PublicAuthorizationService;
  readonly serviceToken?: string;
  readonly now: () => number;
}

const CreateCommandSchema = z
  .object({
    schema_version: z.literal(1),
    deployment_set_digest: z.string().min(1).max(256),
    required_capability: z.string().min(1).max(128),
    policy_version: z.string().min(1).max(64),
    resolution_id: z.string().min(1).max(128),
  })
  .strict();

const ScopeQuerySchema = z
  .object({
    community_ref: z.string().min(1).max(256),
    subject_id: z.string().min(1).max(256),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

function errorJson(c: Context, status: 400 | 401 | 403 | 404 | 409, code: string) {
  return c.json({ schema_version: 1, code }, status, noStoreHeaders());
}

export function mountCapabilityDemandRoutes(app: Hono, deps: CapabilityDemandHttpDeps): void {
  app.post("/v1/capability-demands", async (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }
    const parsedBody = await readAuthorizedBody(c);
    if (!parsedBody.ok) return parsedBody.response;

    let scope;
    try {
      scope = deps.auth.decodeScope(parsedBody.body.authorization_scope);
    } catch {
      return errorJson(c, 400, "invalid_request");
    }

    const command = CreateCommandSchema.safeParse(parsedBody.body.command);
    if (!command.success) {
      return errorJson(c, 400, "invalid_request");
    }
    if (scope.idempotency_key === undefined) {
      return errorJson(c, 400, "invalid_request");
    }

    try {
      deps.auth.acquireLease({
        operation: { resource: "capability_demand", action: "create" },
        scope,
      });
    } catch (err) {
      const mapped = deps.auth.mapDenial(err);
      return c.json(mapped.body, mapped.status, noStoreHeaders());
    }

    const result = await deps.store.create({
      requester_subject: scope.subject_id,
      community_ref: scope.community_ref,
      deployment_set_digest: command.data.deployment_set_digest,
      required_capability: command.data.required_capability,
      policy_version: command.data.policy_version,
      resolution_id: command.data.resolution_id,
      idempotency_key: scope.idempotency_key,
      now_ms: deps.now(),
    });

    if (result.kind === "conflict") {
      return errorJson(c, 409, "idempotency_conflict");
    }

    return c.json(toPublicCapabilityDemandProjection(result.record), 200, noStoreHeaders());
  });

  app.get("/v1/capability-demands", async (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }

    const scopeRaw = {
      schema_version: 1,
      subject_id: c.req.query("subject_id"),
      community_ref: c.req.query("community_ref"),
      permission: "demand:read" as const,
    };
    const query = ScopeQuerySchema.safeParse({
      community_ref: c.req.query("community_ref"),
      subject_id: c.req.query("subject_id"),
      limit: c.req.query("limit") ?? undefined,
    });
    if (!query.success) {
      return errorJson(c, 400, "invalid_request");
    }

    let scope;
    try {
      scope = deps.auth.decodeScope(scopeRaw);
    } catch {
      return errorJson(c, 400, "invalid_request");
    }

    try {
      deps.auth.acquireLease({
        operation: { resource: "capability_demand", action: "list" },
        scope,
        authoritativeCommunityRef: query.data.community_ref,
        authoritativeSubjectId: query.data.subject_id,
      });
    } catch (err) {
      const mapped = deps.auth.mapDenial(err);
      return c.json(mapped.body, mapped.status, noStoreHeaders());
    }

    const items = await deps.store.list({
      community_ref: query.data.community_ref,
      requester_subject: query.data.subject_id,
      limit: query.data.limit ?? 25,
    });

    return c.json(
      {
        schema_version: 1,
        items: items.map(toPublicCapabilityDemandProjection),
      },
      200,
      noStoreHeaders(),
    );
  });

  app.get("/v1/capability-demands/:demand_id", async (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }

    const community_ref = c.req.query("community_ref");
    const subject_id = c.req.query("subject_id");
    if (typeof community_ref !== "string" || typeof subject_id !== "string") {
      return errorJson(c, 400, "invalid_request");
    }

    let scope;
    try {
      scope = deps.auth.decodeScope({
        schema_version: 1,
        subject_id,
        community_ref,
        permission: "demand:read",
      });
    } catch {
      return errorJson(c, 400, "invalid_request");
    }

    try {
      deps.auth.acquireLease({
        operation: { resource: "capability_demand", action: "detail" },
        scope,
        authoritativeCommunityRef: community_ref,
        authoritativeSubjectId: subject_id,
      });
    } catch (err) {
      const mapped = deps.auth.mapDenial(err);
      return c.json(mapped.body, mapped.status, noStoreHeaders());
    }

    const record = await deps.store.get(c.req.param("demand_id"));
    if (
      record === undefined ||
      record.community_ref !== community_ref ||
      record.requester_subject !== subject_id
    ) {
      return errorJson(c, 404, "not_found");
    }

    return c.json(toPublicCapabilityDemandProjection(record), 200, noStoreHeaders());
  });

  app.delete("/v1/capability-demands/:demand_id", async (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }

    const parsedBody = await readAuthorizedBody(c);
    if (!parsedBody.ok) return parsedBody.response;

    let scope;
    try {
      scope = deps.auth.decodeScope(parsedBody.body.authorization_scope);
    } catch {
      return errorJson(c, 400, "invalid_request");
    }

    try {
      deps.auth.acquireLease({
        operation: { resource: "capability_demand", action: "withdraw" },
        scope,
      });
    } catch (err) {
      const mapped = deps.auth.mapDenial(err);
      return c.json(mapped.body, mapped.status, noStoreHeaders());
    }

    const record = await deps.store.withdraw({
      demand_id: c.req.param("demand_id"),
      requester_subject: scope.subject_id,
      community_ref: scope.community_ref,
      now_ms: deps.now(),
    });
    if (record === undefined) {
      return errorJson(c, 404, "not_found");
    }

    return c.json(toPublicCapabilityDemandProjection(record), 200, noStoreHeaders());
  });
}
