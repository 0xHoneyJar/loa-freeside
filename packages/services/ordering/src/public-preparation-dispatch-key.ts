import { createHash } from "node:crypto";

import type { PublicPrepCapability, VersionedDigest } from "./shared-preparation-types.js";

/**
 * Sonar command inbox key — idempotent per generation × deployment × capability × adapter.
 * SDD §6.4 / §12.1 remote command consumption.
 */
export function sonarCommandInboxKey(input: {
  readonly generation: number;
  readonly deployment_id: VersionedDigest;
  readonly capability: PublicPrepCapability;
  readonly adapter_version: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema_version: 1,
        generation: input.generation,
        deployment_id: input.deployment_id,
        capability: input.capability,
        adapter_version: input.adapter_version,
      }),
    )
    .digest("hex");
}

/** Stable external job ref returned by Sonar on replay of the same inbox key. */
export function sonarPhysicalJobRef(commandInboxKey: string): string {
  return `sonar-job:${commandInboxKey.slice(0, 32)}`;
}
