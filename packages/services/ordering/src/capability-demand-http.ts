/**
 * CR-208 capability-demand HTTP edge (recognition-only support demand).
 *
 *   POST   /v1/capability-demands
 *   GET    /v1/capability-demands
 *   GET    /v1/capability-demands/:demand_id
 *   DELETE /v1/capability-demands/:demand_id
 *   POST   /v1/capability-demands/support-events
 *   POST   /v1/capability-demands/:demand_id/decline
 *   GET    /v1/capability-demands/triage-aggregate
 *
 * Auth: Bearer SERVICE_TOKEN (Dashboard BFF / Sonar) + authorization_scope recheck
 * on subject-scoped routes. Internal transition routes are service-bearer only.
 * Public projections expose no subscriber counts or cross-tenant demand.
 * Never creates report orders or shared preparation work.
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
  buildTriageAggregate,
  toPublicCapabilityDemandProjection,
} from "./capability-demand-projection.js";
import { type CapabilityDemandStore } from "./capability-demand-store.js";

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
    network_ref: z.string().min(1).max(128),
    token_standard: z.string().min(1).max(64),
    required_capability: z.string().min(1).max(128),
    policy_version: z.string().min(1).max(64),
    resolution_id: z.string().min(1).max(128),
  })
  .strict();

const SupportEventCommandSchema = z
  .object({
    schema_version: z.literal(1),
    event_id: z.string().min(1).max(256),
    required_capability: z.string().min(1).max(128),
    deployment_set_digest: z.string().min(1).max(256),
    network_ref: z.string().min(1).max(128),
    token_standard: z.string().min(1).max(64),
  })
  .strict();

const ScopeQuerySchema = z
  .object({
    community_ref: z.string().min(1).max(256),
    subject_id: z.string().min(1).max(256),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

function errorJson(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 429,
  code: string,
) {
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
      network_ref: command.data.network_ref,
      token_standard: command.data.token_standard,
      required_capability: command.data.required_capability,
      policy_version: command.data.policy_version,
      resolution_id: command.data.resolution_id,
      idempotency_key: scope.idempotency_key,
      now_ms: deps.now(),
    });

    if (result.kind === "conflict") {
      return errorJson(c, 409, "idempotency_conflict");
    }
    if (result.kind === "quota_exceeded") {
      return errorJson(c, 429, `demand_quota_${result.limit}`);
    }

    return c.json(toPublicCapabilityDemandProjection(result.record), 200, noStoreHeaders());
  });

  app.get("/v1/capability-demands/triage-aggregate", async (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }
    const now_ms = deps.now();
    const openRows = await deps.store.listOpenForTriage(now_ms);
    return c.json(buildTriageAggregate(openRows, now_ms), 200, noStoreHeaders());
  });

  app.post("/v1/capability-demands/support-events", async (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorJson(c, 400, "invalid_request");
    }
    const command = SupportEventCommandSchema.safeParse(body);
    if (!command.success) {
      return errorJson(c, 400, "invalid_request");
    }

    const result = await deps.store.applyCapabilitySupport({
      ...command.data,
      now_ms: deps.now(),
    });

    return c.json(
      {
        schema_version: 1,
        replay: result.replay,
        transitioned: result.transitioned.map(toPublicCapabilityDemandProjection),
        intents: result.intents,
      },
      200,
      noStoreHeaders(),
    );
  });

  app.get("/v1/capability-demands", async (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }

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
      scope = deps.auth.decodeScope({
        schema_version: 1,
        subject_id: query.data.subject_id,
        community_ref: query.data.community_ref,
        permission: "demand:read",
      });
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

    const now_ms = deps.now();
    const items = await deps.store.list({
      community_ref: query.data.community_ref,
      requester_subject: query.data.subject_id,
      limit: query.data.limit ?? 25,
      now_ms,
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

  app.post("/v1/capability-demands/:demand_id/decline", async (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }
    const record = await deps.store.decline({
      demand_id: c.req.param("demand_id"),
      now_ms: deps.now(),
    });
    if (record === undefined) {
      return errorJson(c, 404, "not_found");
    }
    return c.json(toPublicCapabilityDemandProjection(record), 200, noStoreHeaders());
  });
}
