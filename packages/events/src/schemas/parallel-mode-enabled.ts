import { Schema as S } from "@effect/schema";
import { jcsCanonicalize, sha256Hex } from "../jcs.js";

/**
 * Payload schema for `parallel.mode.enabled.v1` — the cycle-112 PILOT event
 * (the first in-repo seam migrated onto emit()).
 *
 * The raw emit (parallel-mode-orchestrator.ts:265) inlined the FULL parallel-mode
 * config. To avoid coupling the EVENT schema to the entire config schema (a
 * schema-evolution liability — NG-7), the event carries a bounded, stable subset
 * plus a `config_hash` for provenance. Validation-only (no S.transform — the
 * registry signs the ORIGINAL payload; SKP-004).
 */
export const ParallelModeEnabledSchema = S.Struct({
  community_id: S.String,
  guild_id: S.String,
  /** sha256(JCS(stable config subset)) — see configHash. Verifiable: a consumer
   *  re-derives it from the config and compares (IMP-004). */
  config_hash: S.String.pipe(
    S.pattern(/^[0-9a-f]{64}$/, { message: () => "must be 64 lowercase hex chars (sha256)" }),
  ),
  mode: S.Literal("parallel", "shadow"),
  /** ISO-8601 UTC. */
  enabled_at: S.String.pipe(
    S.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/, {
      message: () => "must be ISO-8601 UTC with trailing Z",
    }),
  ),
});

export type ParallelModeEnabled = S.Schema.Type<typeof ParallelModeEnabledSchema>;

/**
 * Compute `config_hash` deterministically (IMP-004). The caller passes the
 * STABLE subset of the config (exclude volatile fields like timestamps/version
 * counters so the hash does not flap). The derivation is pinned:
 * `sha256(JCS(stableSubset))`, reusing the same JCS the envelope uses — so any
 * consumer that re-derives from the same subset gets a byte-identical hash.
 */
export function configHash(stableSubset: unknown): string {
  return sha256Hex(jcsCanonicalize(stableSubset));
}
