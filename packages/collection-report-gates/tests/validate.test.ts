import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeGateManifestSync,
  validateGateManifest,
  type GateManifestT,
  type GateStateT,
} from "../src/index.js";
import {
  fixturePath,
  loadApprovalAuthorities,
  loadManifest,
  loadSourceInventory,
  readYaml,
} from "./test-helpers.js";

const findingCodes = (result: ReturnType<typeof validateGateManifest>) =>
  new Set(result.findings.map((finding) => finding.code));
const ownerApproved: GateManifestT["status"] = "owner_approved";
const passed: GateStateT = "pass";

describe("semantic rejection matrix", () => {
  it("rejects a missing canonical CR", () => {
    const manifest = loadManifest();
    const mutated = {
      ...manifest,
      tasks: manifest.tasks.filter((task) => task.id !== "CR-402"),
    };
    const result = validateGateManifest(mutated, {
      source: loadSourceInventory(),
    });
    assert.equal(findingCodes(result).has("MISSING_CR"), true);
  });

  it("rejects conflicting duplicate primary ownership", () => {
    const manifest = loadManifest();
    const first = manifest.tasks[0];
    assert.ok(first);
    const result = validateGateManifest({
      ...manifest,
      tasks: [
        ...manifest.tasks,
        { ...first, primary_owner: "conflicting-owner" },
      ],
    });
    assert.equal(
      findingCodes(result).has("DUPLICATE_PRIMARY_OWNERSHIP"),
      true,
    );
  });

  it("rejects gate task/evidence producer drift", () => {
    const manifest = loadManifest();
    const result = validateGateManifest({
      ...manifest,
      gates: manifest.gates.map((gate) =>
        gate.id === "G0"
          ? {
              ...gate,
              requires_tasks: gate.requires_tasks.filter(
                (task) => task !== "CR-005",
              ),
            }
          : gate,
      ),
    });
    assert.equal(findingCodes(result).has("GATE_EVIDENCE_DRIFT"), true);
  });

  it("rejects task dependency cycles", () => {
    const manifest = loadManifest();
    const mutated = {
      ...manifest,
      tasks: manifest.tasks.map((task) =>
        task.id === "CR-001"
          ? { ...task, depends_on: ["CR-002"] }
          : task,
      ),
    };
    const result = validateGateManifest(mutated);
    assert.equal(findingCodes(result).has("DEPENDENCY_CYCLE"), true);
  });

  it("rejects expired dynamic evidence at the exact expiry instant", () => {
    const manifest = loadManifest();
    const target = manifest.gates.find((gate) => gate.id === "G-1");
    assert.ok(target);
    const mutated = {
      ...manifest,
      status: ownerApproved,
      gates: manifest.gates.map((gate) =>
        gate.id === target.id
          ? {
              ...gate,
              state: passed,
              evidence: gate.evidence.map((evidence) => ({
                ...evidence,
                recorded_at: "2026-07-15T00:00:00Z",
                validity: {
                  valid_until: manifest.evaluated_at,
                  max_age_days: 90,
                  renewal_owner: "discord-application-owner",
                },
              })),
            }
          : gate,
      ),
    };
    const result = validateGateManifest(mutated);
    assert.equal(findingCodes(result).has("EXPIRED_EVIDENCE"), true);
  });

  it("rejects an enabled flag before owner approval and gate passage", () => {
    const manifest = loadManifest();
    const first = manifest.flags[0];
    assert.ok(first);
    const result = validateGateManifest({
      ...manifest,
      flags: [{ ...first, enabled: true }, ...manifest.flags.slice(1)],
    });
    assert.equal(findingCodes(result).has("PREMATURE_FLAG"), true);
  });

  it("rejects a No-go decision without recorded evidence", () => {
    const manifest = loadManifest();
    const result = validateGateManifest({
      ...manifest,
      status: ownerApproved,
      gates: manifest.gates.map((gate) =>
        gate.id === "G-1" ? { ...gate, state: "no_go" } : gate,
      ),
    });
    assert.equal(
      findingCodes(result).has("DECISION_WITHOUT_EVIDENCE"),
      true,
    );
  });

  it("rejects a No-go decision backed by expired evidence", () => {
    const manifest = loadManifest();
    const result = validateGateManifest({
      ...manifest,
      status: ownerApproved,
      gates: manifest.gates.map((gate) =>
        gate.id === "G-1"
          ? {
              ...gate,
              state: "no_go",
              evidence: gate.evidence.map((evidence) => ({
                ...evidence,
                recorded_at: "2026-04-01T00:00:00Z",
                validity: {
                  max_age_days: 90,
                  renewal_owner: "discord-application-owner",
                  valid_until: manifest.evaluated_at,
                },
              })),
            }
          : gate,
      ),
    });
    assert.equal(
      findingCodes(result).has("DECISION_WITHOUT_EVIDENCE"),
      true,
    );
  });

  it("rejects tier tasks that are outside independent entry-task closure", () => {
    const manifest = loadManifest();
    const result = validateGateManifest({
      ...manifest,
      tiers: manifest.tiers.map((tier) =>
        tier.id === "T0"
          ? {
              ...tier,
              tasks: [...tier.tasks, "CR-019"],
              summary: {
                ...tier.summary,
                tasks: [...tier.summary.tasks, "CR-019"],
              },
            }
          : tier,
      ),
    });
    assert.equal(findingCodes(result).has("TIER_OVERCLAIM"), true);
  });

  it("reserves acceptance IDs for tier acceptance arrays", () => {
    const manifest = loadManifest();
    const result = validateGateManifest({
      ...manifest,
      tiers: manifest.tiers.map((tier) =>
        tier.id === "T0"
          ? {
              ...tier,
              entry_tasks: [...tier.entry_tasks, "ACCEPT-LOA"],
              tasks: [...tier.tasks, "ACCEPT-LOA"],
              summary: {
                ...tier.summary,
                tasks: [...tier.summary.tasks, "ACCEPT-LOA"],
              },
            }
          : tier,
      ),
    });
    assert.equal(findingCodes(result).has("TASK_KIND_MISMATCH"), true);
  });

  it("rejects future-recorded static evidence", () => {
    const manifest = loadManifest();
    const target = manifest.gates.find((gate) =>
      gate.evidence.some(
        (evidence) => !("max_age_days" in evidence.validity),
      ),
    );
    assert.ok(target);
    const result = validateGateManifest({
      ...manifest,
      gates: manifest.gates.map((gate) =>
        gate.id === target.id
          ? {
              ...gate,
              evidence: gate.evidence.map((evidence) => ({
                ...evidence,
                recorded_at: "2026-07-17T00:00:00Z",
              })),
            }
          : gate,
      ),
    });
    assert.equal(findingCodes(result).has("IMPOSSIBLE_BRANCH"), true);
  });

  it("rejects an approval receipt not bound to the exact manifest", () => {
    const manifest = decodeGateManifestSync(
      readYaml(
        fixturePath(
          "test-vectors",
          "positive",
          "no-go-preserves-t0-t1.yaml",
        ),
      ),
    );
    const first = manifest.approvals[0];
    assert.ok(first);
    const result = validateGateManifest(
      {
        ...manifest,
        approvals: [
          {
            ...first,
            manifest_digest: `sha256:${"0".repeat(64)}`,
          },
          ...manifest.approvals.slice(1),
        ],
      },
      { approvalAuthorities: loadApprovalAuthorities() },
    );
    assert.equal(
      findingCodes(result).has("MANIFEST_APPROVAL_INVALID"),
      true,
    );
  });

  it("rejects pass over an unpassed dependency", () => {
    const manifest = loadManifest();
    const dependent = manifest.gates.find(
      (gate) => gate.depends_on_gates.length > 0,
    );
    assert.ok(dependent);
    const result = validateGateManifest({
      ...manifest,
      status: "owner_approved",
      gates: manifest.gates.map((gate) =>
        gate.id === dependent.id
          ? {
              ...gate,
              state: "pass",
              evidence: gate.evidence.map((evidence) => ({
                ...evidence,
                recorded_at: "2026-07-15T00:00:00Z",
              })),
            }
          : gate,
      ),
    });
    assert.equal(findingCodes(result).has("IMPOSSIBLE_BRANCH"), true);
  });

  it("keeps T0/T1 reachable and makes T2 unreachable on G-1 no-go", () => {
    const manifest = decodeGateManifestSync(
      readYaml(
        fixturePath(
          "test-vectors",
          "positive",
          "no-go-preserves-t0-t1.yaml",
        ),
      ),
    );
    const result = validateGateManifest(manifest, {
      approvalAuthorities: loadApprovalAuthorities(),
    });
    assert.equal(result.valid, true);
    const tiers = new Map(result.tiers.map((tier) => [tier.tier, tier]));
    assert.equal(tiers.get("T0")?.reachable, true);
    assert.equal(tiers.get("T1")?.reachable, true);
    assert.equal(tiers.get("T2")?.reachable, false);
  });
});
