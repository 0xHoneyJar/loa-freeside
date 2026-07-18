import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  GATE_LEAK_MAX_IDENTITY_LINK_PAGES,
  GATE_LEAK_NODE_TYPES,
  GATE_LEAK_PUBLIC_NODES_PER_DEPLOYMENT,
  compileGateLeakRecipe,
  SelectionTooLargeError,
} from "../gate-leak-recipe-compiler.js";
import { V1_MAX_DEPLOYMENTS, V1_MAX_RECIPE_NODES } from "../admission-capacity-constants.js";

describe("CR-202 gate-leak recipe compiler", () => {
  it("enumerates every node type in a fixed catalog", () => {
    expect(GATE_LEAK_NODE_TYPES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(GATE_LEAK_NODE_TYPES).size).toBe(GATE_LEAK_NODE_TYPES.length);
  });

  it("proves worst-case bound <=160 for max deployments", () => {
    const compiled = compileGateLeakRecipe({
      deployment_count: V1_MAX_DEPLOYMENTS,
      tier: "public",
    });
    expect(compiled.worst_case_total_nodes).toBeLessThanOrEqual(V1_MAX_RECIPE_NODES);
    expect(compiled.root_reference_count).toBe(
      V1_MAX_DEPLOYMENTS * GATE_LEAK_PUBLIC_NODES_PER_DEPLOYMENT,
    );
    expect(compiled.certificate.worst_case_total_nodes).toBe(compiled.worst_case_total_nodes);
    expect(compiled.certificate.root_count).toBe(compiled.root_reference_count);
  });

  it("rejects deployment overflow before admission", () => {
    expect(() =>
      compileGateLeakRecipe({ deployment_count: V1_MAX_DEPLOYMENTS + 1 }),
    ).toThrow(SelectionTooLargeError);
  });

  it("is deterministic for the same deployment count", () => {
    const a = compileGateLeakRecipe({ deployment_count: 2, tier: "public" });
    const b = compileGateLeakRecipe({ deployment_count: 2, tier: "public" });
    expect(a.certificate).toEqual(b.certificate);
    expect(a.public_root_work_key_count).toBe(GATE_LEAK_PUBLIC_NODES_PER_DEPLOYMENT);
  });

  it("accounts for restricted expansion branches in worst-case total", () => {
    const one = compileGateLeakRecipe({ deployment_count: 1, tier: "public" });
    expect(one.worst_case_total_nodes).toBe(
      GATE_LEAK_PUBLIC_NODES_PER_DEPLOYMENT + 3 + 1 + GATE_LEAK_MAX_IDENTITY_LINK_PAGES,
    );
  });
});
