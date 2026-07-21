import { describe, expect, it } from "vitest";
import { DEPENDENCY_EDGE_CAPABILITY, DEPENDENCY_EDGE_CONTRACT } from "../version.js";
import { decodeDependencyEdgeBody } from "../contracts.js";

describe("dependency ledger protocol surface", () => {
  it("exports stable CR-012A contract identifiers", () => {
    expect(DEPENDENCY_EDGE_CAPABILITY).toBe("collection-report.dependency-edge.v1");
    expect(DEPENDENCY_EDGE_CONTRACT.name).toBe("collection-report.dependency-edge");
  });

  it("strictly decodes dependency edge bodies", () => {
    const body = decodeDependencyEdgeBody({
      schema_version: 1,
      schema_minor: 0,
      edge_kind: "evidence",
      edge_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      derivative: {
        derivative_kind: "shared_preparation",
        derivative_id: "prep-1",
      },
      required_edge_ids: [],
      source_watermark: {
        stream_id: "sonar.public-capability.v1",
        stream_epoch: 1,
        sequence: 1,
      },
    });
    expect(body.edge_kind).toBe("evidence");
  });
});
