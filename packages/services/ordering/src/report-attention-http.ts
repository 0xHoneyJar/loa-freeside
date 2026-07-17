/**
 * CR-305 — authenticated mark-seen for report attention.
 *
 *   POST /v1/report-attention/:source_kind/:source_id/:transition_sequence/seen
 *
 * Body: { subject_id, community_ref }
 * Never mutates order lifecycle state.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";

import type { OrderStore } from "./store.js";
import {
  REPORT_ATTENTION_SOURCE_KIND,
  type ReportAttentionStore,
} from "./report-attention-store.js";
import { mapAttentionKind, transitionSequenceOf } from "./collection-report-projection.js";

export interface ReportAttentionHttpDeps {
  readonly store: OrderStore;
  readonly attentionStore: ReportAttentionStore;
  readonly serviceToken?: string;
}

const SeenBodySchema = z
  .object({
    subject_id: z.string().min(1).max(256),
    community_ref: z.string().min(1).max(128),
  })
  .strict();

function requireBearer(c: Context, token: string | undefined): boolean {
  if (!token) return true;
  return c.req.header("authorization") === `Bearer ${token}`;
}

function errorJson(
  c: Context,
  status: 400 | 401 | 403 | 404,
  code: string,
): Response {
  return c.json(
    { schema_version: 1, code },
    status,
    { "Cache-Control": "no-store" },
  );
}

export function mountReportAttentionRoutes(
  app: Hono,
  deps: ReportAttentionHttpDeps,
): void {
  app.post(
    "/v1/report-attention/:source_kind/:source_id/:transition_sequence/seen",
    async (c) => {
      if (!requireBearer(c, deps.serviceToken)) {
        return errorJson(c, 401, "unauthorized");
      }

      const source_kind = c.req.param("source_kind");
      const source_id = c.req.param("source_id");
      const transitionRaw = c.req.param("transition_sequence");
      const transition_sequence = Number(transitionRaw);

      if (source_kind !== REPORT_ATTENTION_SOURCE_KIND) {
        return errorJson(c, 400, "invalid_request");
      }
      if (
        typeof source_id !== "string" ||
        source_id.length === 0 ||
        !Number.isSafeInteger(transition_sequence) ||
        transition_sequence < 0
      ) {
        return errorJson(c, 400, "invalid_request");
      }

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return errorJson(c, 400, "invalid_request");
      }
      const parsed = SeenBodySchema.safeParse(raw);
      if (!parsed.success) {
        return errorJson(c, 400, "invalid_request");
      }

      const record = await deps.store.get(source_id);
      if (!record || record.product !== "collection-report") {
        return errorJson(c, 404, "not_found");
      }
      if (record.placed_by !== parsed.data.subject_id) {
        return errorJson(c, 403, "forbidden");
      }
      const inputs = record.inputs as { community_ref?: unknown };
      if (inputs.community_ref !== parsed.data.community_ref) {
        return errorJson(c, 403, "forbidden");
      }

      // Only attention-bearing states accept receipts (routine progress ignored).
      if (mapAttentionKind(record) === null) {
        return errorJson(c, 404, "not_found");
      }

      const expectedSeq = transitionSequenceOf(record);
      if (expectedSeq !== transition_sequence) {
        return errorJson(c, 404, "not_found");
      }

      const receipt = await deps.attentionStore.markSeen({
        subject_ref: parsed.data.subject_id,
        source_kind: REPORT_ATTENTION_SOURCE_KIND,
        source_id,
        transition_sequence,
        community_ref: parsed.data.community_ref,
      });

      return c.json(
        {
          schema_version: 1,
          source_kind: receipt.source_kind,
          source_id: receipt.source_id,
          transition_sequence: receipt.transition_sequence,
          subject_id: receipt.subject_ref,
          community_ref: receipt.community_ref,
          seen_at_unix: receipt.seen_at_unix,
        },
        200,
        { "Cache-Control": "no-store" },
      );
    },
  );
}
