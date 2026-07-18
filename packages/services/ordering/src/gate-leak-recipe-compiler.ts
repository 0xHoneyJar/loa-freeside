/**
 * CR-202 deterministic Gate Leak recipe compiler (T1 public path).
 *
 * Enumerates every possible node type and proves a recipe-specific worst-case
 * node/capacity bound <=160 before admission. Runtime evidence determines
 * which certified branches materialize — never an unknown graph shape.
 */

import {
  V1_MAX_DEPLOYMENTS,
  V1_MAX_RECIPE_NODES,
  V1_MAX_ROOT_REFERENCES,
} from "./admission-capacity-constants.js";
import type { RecipeExpansionCertificate } from "./admission-capacity-types.js";
import { buildRecipeExpansionCertificate } from "./recipe-expansion-certificate.js";

export const GATE_LEAK_COMPILER_VERSION = "gate-leak-public.v1" as const;

/** Every node type the Gate Leak v1 recipe may expand — fixed catalog. */
export const GATE_LEAK_NODE_TYPES = [
  "public.collection_identity_per_deployment",
  "public.ownership_index_per_deployment",
  "restricted.gate_mapping",
  "restricted.discord_role_snapshot",
  "restricted.identity_link_snapshot",
  "restricted.identity_link_page",
  "order.gate_leak_compute",
] as const;

export type GateLeakNodeType = (typeof GATE_LEAK_NODE_TYPES)[number];

export const GATE_LEAK_PUBLIC_NODES_PER_DEPLOYMENT = 2;
export const GATE_LEAK_RESTRICTED_COMMUNITY_NODES = 3;
export const GATE_LEAK_COMPUTE_NODES = 1;
/** V1: 50_000 subjects / 500 per page. */
export const GATE_LEAK_MAX_IDENTITY_LINK_PAGES = 100;

export class SelectionTooLargeError extends Error {
  readonly code = "selection_too_large" as const;
  constructor(deploymentCount: number) {
    super(`selection exceeds ${V1_MAX_DEPLOYMENTS} deployments (${deploymentCount})`);
    this.name = "SelectionTooLargeError";
  }
}

export class WorkflowTooLargeError extends Error {
  readonly code = "workflow_too_large" as const;
  constructor(worstCaseNodes: number) {
    super(`compiled recipe worst-case ${worstCaseNodes} exceeds ${V1_MAX_RECIPE_NODES}`);
    this.name = "WorkflowTooLargeError";
  }
}

export interface CompileGateLeakRecipeInput {
  readonly deployment_count: number;
  /** T1 uses public-only materialization; full tier reserved for T2 restricted path. */
  readonly tier?: "public" | "full";
}

export interface CompiledGateLeakRecipe {
  readonly certificate: RecipeExpansionCertificate;
  readonly node_type_catalog: readonly GateLeakNodeType[];
  readonly public_root_work_key_count: number;
  readonly root_reference_count: number;
  readonly worst_case_total_nodes: number;
}

export function compileGateLeakRecipe(input: CompileGateLeakRecipeInput): CompiledGateLeakRecipe {
  const deploymentCount = input.deployment_count;
  if (deploymentCount <= 0) {
    throw new Error("deployment_count must be positive");
  }
  if (deploymentCount > V1_MAX_DEPLOYMENTS) {
    throw new SelectionTooLargeError(deploymentCount);
  }

  const root_reference_count = deploymentCount * GATE_LEAK_PUBLIC_NODES_PER_DEPLOYMENT;
  if (root_reference_count > V1_MAX_ROOT_REFERENCES) {
    throw new WorkflowTooLargeError(root_reference_count);
  }

  const worst_case_total_nodes =
    root_reference_count +
    GATE_LEAK_RESTRICTED_COMMUNITY_NODES +
    GATE_LEAK_COMPUTE_NODES +
    GATE_LEAK_MAX_IDENTITY_LINK_PAGES;

  if (worst_case_total_nodes > V1_MAX_RECIPE_NODES) {
    throw new WorkflowTooLargeError(worst_case_total_nodes);
  }

  const public_root_work_key_count = GATE_LEAK_PUBLIC_NODES_PER_DEPLOYMENT;
  const certificate = buildRecipeExpansionCertificate({
    compiler_version: GATE_LEAK_COMPILER_VERSION,
    root_count: root_reference_count,
    worst_case_total_nodes,
    capacity_weight: public_root_work_key_count,
  });

  return {
    certificate,
    node_type_catalog: GATE_LEAK_NODE_TYPES,
    public_root_work_key_count,
    root_reference_count,
    worst_case_total_nodes,
  };
}
