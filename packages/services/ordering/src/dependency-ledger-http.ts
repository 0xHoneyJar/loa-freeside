/**
 * CR-012A dependency ledger inbox HTTP edge.
 *
 *   POST /v1/dependency-ledger/inbox/envelopes
 *   GET  /v1/dependency-ledger/derivatives/:derivative_kind/:derivative_id
 *   GET  /v1/dependency-ledger/metrics
 *
 * Service-bearer only. Consumes CR-009 trust envelopes with CR-013 intake gate.
 * CR-011A Sonar producer outbox wiring lands separately — this is Ordering-side
 * inbox + reverse-dependency ledger readiness.
 */

import { Hono, type Context } from "hono";
import { decodeTrustEnvelope, TrustEnvelopeRejectedError } from "@freeside/trust-envelope-protocol";
import { requireServiceBearer, noStoreHeaders } from "./public-authorization-http.js";
import type { DependencyLedgerService } from "./dependency-ledger-service.js";
import { DependencyLedgerRejectedError } from "@freeside/dependency-ledger-protocol";
import { KeyCustodyRejectedError } from "@freeside/signing-key-custody-protocol";

export interface DependencyLedgerHttpDeps {
  readonly service: DependencyLedgerService;
  readonly serviceToken?: string;
}

function rejectionStatus(error: unknown): 400 | 403 | 409 {
  if (error instanceof DependencyLedgerRejectedError) {
    if (error.safe_code === "edge_id_conflict") return 409;
    return 400;
  }
  if (error instanceof KeyCustodyRejectedError) return 403;
  if (error instanceof TrustEnvelopeRejectedError) return 403;
  return 400;
}

function errorJson(c: Context, status: 400 | 403 | 409, code: string, remediation?: string) {
  return c.json(
    {
      schema_version: 1,
      code,
      ...(remediation !== undefined ? { remediation } : {}),
    },
    status,
    noStoreHeaders(),
  );
}

export function mountDependencyLedgerRoutes(app: Hono, deps: DependencyLedgerHttpDeps): void {
  app.post("/v1/dependency-ledger/inbox/envelopes", async (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 403, "unauthorized");
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return errorJson(c, 400, "invalid_json");
    }

    let envelope;
    try {
      envelope = decodeTrustEnvelope(raw);
    } catch {
      return errorJson(c, 400, "invalid_trust_envelope");
    }

    const result = deps.service.ingestEnvelope(envelope);
    if (result.kind === "rejected") {
      const remediation =
        "remediation" in result.error ? result.error.remediation : undefined;
      return errorJson(
        c,
        rejectionStatus(result.error),
        result.error instanceof DependencyLedgerRejectedError
          ? result.error.safe_code
          : result.error instanceof KeyCustodyRejectedError
            ? result.error.reason
            : result.error instanceof TrustEnvelopeRejectedError
              ? result.error.reason
              : "rejected",
        remediation,
      );
    }

    const closure = deps.service.getDerivative(result.edge.derivative_key);
    return c.json(
      {
        schema_version: 1,
        event_id: result.edge.event_id,
        edge_id: result.edge.edge_id,
        derivative_key: result.edge.derivative_key,
        replay: result.replay,
        closure: closure
          ? {
              state: closure.state,
              fulfillable: closure.fulfillable,
              quarantine_reason: closure.quarantine_reason,
              denied_reason: closure.denied_reason,
            }
          : null,
      },
      result.replay ? 200 : 201,
      noStoreHeaders(),
    );
  });

  app.get("/v1/dependency-ledger/derivatives/:derivative_kind/:derivative_id", (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 403, "unauthorized");
    }

    const derivativeKey = `${c.req.param("derivative_kind")}:${c.req.param("derivative_id")}`;
    const closure = deps.service.getDerivative(derivativeKey);
    if (closure === undefined) {
      return c.json({ schema_version: 1, code: "derivative_not_found" }, 404, noStoreHeaders());
    }

    return c.json(
      {
        schema_version: 1,
        derivative_key: closure.derivative_key,
        derivative: closure.derivative,
        state: closure.state,
        fulfillable: closure.fulfillable,
        required_edge_ids: closure.required_edge_ids,
        received_edge_ids: closure.received_edge_ids,
        quarantine_reason: closure.quarantine_reason,
        denied_reason: closure.denied_reason,
        repair_deadline_ms: closure.repair_deadline_ms,
      },
      200,
      noStoreHeaders(),
    );
  });

  app.get("/v1/dependency-ledger/metrics", (c) => {
    if (!requireServiceBearer(c, deps.serviceToken)) {
      return errorJson(c, 403, "unauthorized");
    }

    return c.json(
      {
        schema_version: 1,
        metrics: deps.service.metrics(),
        cr_011a_producer: "pending",
        note: "Ordering inbox ready; G1B-1 Sonar producer replay blocked on CR-011A (f09.43).",
      },
      200,
      noStoreHeaders(),
    );
  });
}
