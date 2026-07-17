import { z } from "zod";

const VersionedDigest = z
  .object({
    algorithm: z.literal("sha-256"),
    domain: z.string().min(1),
    major_version: z.number().int().min(1),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

/** Inputs for collection-report orders — resolution binding only. */
export const CollectionReportInputs = z
  .object({
    schema_version: z.literal(1),
    resolution_id: z.string().min(1),
    candidate_snapshot_digest: VersionedDigest,
    community_ref: z.string().min(1),
  })
  .strict();
export type CollectionReportInputs = z.infer<typeof CollectionReportInputs>;
