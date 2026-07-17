/**
 * CR-201C fixture/stub recipe expansion certificate.
 * CR-202 replaces this with the deterministic recipe compiler.
 */

import { createHash } from "node:crypto";
import { V1_MAX_RECIPE_NODES, V1_MAX_ROOT_REFERENCES } from "./admission-capacity-constants.js";
import type { RecipeExpansionCertificate } from "./admission-capacity-types.js";
import { CapacityUnavailableError } from "./admission-capacity-types.js";

export function digestRecipeCertificate(material: {
  compiler_version: string;
  root_count: number;
  worst_case_total_nodes: number;
  capacity_weight: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schema_version: 1,
        compiler_version: material.compiler_version,
        root_count: material.root_count,
        worst_case_total_nodes: material.worst_case_total_nodes,
        capacity_weight: material.capacity_weight,
      }),
    )
    .digest("hex");
}

export function buildRecipeExpansionCertificate(input: {
  compiler_version?: string;
  root_count: number;
  worst_case_total_nodes: number;
  capacity_weight?: number;
}): RecipeExpansionCertificate {
  const compiler_version = input.compiler_version ?? "fixture-compiler.v1";
  const capacity_weight = input.capacity_weight ?? input.worst_case_total_nodes;
  const certificate_digest = digestRecipeCertificate({
    compiler_version,
    root_count: input.root_count,
    worst_case_total_nodes: input.worst_case_total_nodes,
    capacity_weight,
  });
  return {
    schema_version: 1,
    compiler_version,
    root_count: input.root_count,
    worst_case_total_nodes: input.worst_case_total_nodes,
    capacity_weight,
    certificate_digest,
  };
}

/** Gate Leak public fixture: 16 deployments × 2 public nodes = 32 root refs. */
export function fixtureGateLeakCertificate(deploymentCount = 2): RecipeExpansionCertificate {
  const root_count = deploymentCount * 2;
  return buildRecipeExpansionCertificate({
    root_count,
    worst_case_total_nodes: root_count,
    capacity_weight: 1,
  });
}

export function assertCertificateAdmissible(cert: RecipeExpansionCertificate): void {
  if (
    cert.worst_case_total_nodes > V1_MAX_RECIPE_NODES ||
    cert.root_count > V1_MAX_ROOT_REFERENCES ||
    cert.capacity_weight <= 0
  ) {
    throw new CapacityUnavailableError(
      "certificate_too_large",
      `recipe certificate exceeds V1 ceilings (nodes=${cert.worst_case_total_nodes}, roots=${cert.root_count})`,
    );
  }
}
