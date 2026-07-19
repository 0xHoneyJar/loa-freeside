import { z } from 'zod';
import {
  AuditOutputSchema,
  DriftReportSchema,
} from './schemas/audit-output.js';
import { RefusalSchema } from './schemas/refusal.js';

/**
 * The 422 response consumed by freeside-dashboard. Keep this sealed just like the success schema: the
 * refusal-with-drift path is the primary thj response, not an incidental diagnostic.
 */
export const AuditRefusalEnvelopeSchema = z
  .object({
    error: RefusalSchema,
    drift: DriftReportSchema.optional(),
  })
  .strict();
export type AuditRefusalEnvelope = z.infer<typeof AuditRefusalEnvelopeSchema>;

/** Exact anonymous 200 projection consumed by the dashboard; authed-only optional fields are excluded. */
export const AnonymousAuditOutputSchema = AuditOutputSchema.pick({
  run_id: true,
  mode: true,
  inputs_hash: true,
  protocol_version: true,
  aggregate: true,
  cta: true,
});
export type AnonymousAuditOutput = z.infer<typeof AnonymousAuditOutputSchema>;
