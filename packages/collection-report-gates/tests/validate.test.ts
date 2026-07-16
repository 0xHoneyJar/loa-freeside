import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeApprovalManifestDigest,
  decodeGateManifestSync,
  flattenTaskManifest,
  validateGateManifest,
  verifyManifestApproval,
  type GateManifestT,
  type GateStateT,
} from "../src/index.js";
import {
  fixturePath,
  loadApprovalAuthorities,
  loadManifest,
  loadRepositoryAcceptanceAuthorities,
  loadRepositoryAcceptanceReceipts,
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

  it("rejects an enabled flag with no tier acceptance boundary", () => {
    const manifest = loadManifest();
    const first = manifest.flags[0];
    assert.ok(first);
    const { tier: omittedTier, ...withoutTier } = first;
    assert.ok(omittedTier);
    const result = validateGateManifest({
      ...manifest,
      flags: [
        { ...withoutTier, enabled: true },
        ...manifest.flags.slice(1),
      ],
    });
    assert.equal(
      result.findings.some(
        (finding) =>
          finding.code === "PREMATURE_FLAG" &&
          finding.path === "flags[0].tier",
      ),
      true,
    );
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

  it("keeps the committed signed approval fixture synchronized", () => {
    const manifest = decodeGateManifestSync(
      readYaml(
        fixturePath(
          "test-vectors",
          "positive",
          "no-go-preserves-t0-t1.yaml",
        ),
      ),
    );
    const expectedDigest = computeApprovalManifestDigest(manifest);
    const authorities = loadApprovalAuthorities();

    for (const approval of manifest.approvals) {
      const authority = authorities.get(approval.owner);
      assert.ok(
        authority,
        `signed approval fixture has no trusted key for ${approval.owner}`,
      );
      assert.equal(
        approval.manifest_digest,
        expectedDigest,
        `signed approval fixture for ${approval.owner} is stale; re-sign it against the current fixture manifest`,
      );
      assert.equal(
        approval.key_id,
        authority.key_id,
        `signed approval fixture for ${approval.owner} uses an unexpected key`,
      );
      assert.equal(
        verifyManifestApproval(approval, authority.public_key),
        true,
        `signed approval fixture for ${approval.owner} has an invalid signature`,
      );
    }
  });

  it("does not let gate-owner approvals substitute for repository acceptance", () => {
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
    assert.equal(findingCodes(result).has("OWNER_ACCEPTANCE_MISSING"), true);
    assert.equal(findingCodes(result).has("PREMATURE_FLAG"), true);
    const t0 = result.tiers.find((tier) => tier.tier === "T0");
    assert.equal(t0?.structurally_possible, true);
    assert.equal(t0?.release_ready, false);
    assert.deepEqual(t0?.missing_owner_acceptance, [
      "ACCEPT-LOA",
      "ACCEPT-SONAR",
    ]);
  });

  it("rejects repository acceptance if signed content is changed", () => {
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
      acceptanceReceipts: loadRepositoryAcceptanceReceipts(
        "negative",
        "repository-acceptance-tampered.yaml",
      ),
      acceptanceAuthorities: loadRepositoryAcceptanceAuthorities(),
    });
    assert.equal(findingCodes(result).has("OWNER_ACCEPTANCE_INVALID"), true);
    assert.equal(
      result.findings.some(
        (finding) =>
          finding.code === "OWNER_ACCEPTANCE_INVALID" &&
          finding.path.endsWith(".signature"),
      ),
      true,
    );
  });

  it("retains duplicate source task IDs instead of overwriting ownership", () => {
    const flattened = flattenTaskManifest({
      child_repos: [
        {
          slug: "0xHoneyJar/loa-freeside",
          tasks: [{ id: "CR-001" }],
        },
        {
          slug: "0xHoneyJar/sonar-api",
          tasks: [{ id: "CR-001" }],
        },
      ],
    });
    assert.equal(flattened.tasks.get("CR-001"), "0xHoneyJar/loa-freeside");
    assert.deepEqual(flattened.duplicate_task_ids, ["CR-001"]);
    const source = loadSourceInventory();
    const result = validateGateManifest(loadManifest(), {
      source: {
        ...source,
        duplicate_task_ids: ["CR-001"],
      },
    });
    assert.equal(
      result.findings.some(
        (finding) =>
          finding.code === "DUPLICATE_ID" &&
          finding.path === "source.tasks",
      ),
      true,
    );
  });

  it("does not report release-ready when acceptance receipts are duplicated", () => {
    const manifest = decodeGateManifestSync(
      readYaml(
        fixturePath(
          "test-vectors",
          "positive",
          "no-go-preserves-t0-t1.yaml",
        ),
      ),
    );
    const receipts = loadRepositoryAcceptanceReceipts();
    const first = receipts[0];
    assert.ok(first);
    const result = validateGateManifest(manifest, {
      approvalAuthorities: loadApprovalAuthorities(),
      acceptanceReceipts: [...receipts, first],
      acceptanceAuthorities: loadRepositoryAcceptanceAuthorities(),
    });
    assert.equal(findingCodes(result).has("DUPLICATE_ID"), true);
    assert.equal(
      result.tiers.find((tier) => tier.tier === "T0")?.release_ready,
      false,
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

  it("keeps T0/T1 release-ready and makes T2 structurally impossible on G-1 no-go", () => {
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
      acceptanceReceipts: loadRepositoryAcceptanceReceipts(),
      acceptanceAuthorities: loadRepositoryAcceptanceAuthorities(),
    });
    assert.equal(result.valid, true);
    const tiers = new Map(result.tiers.map((tier) => [tier.tier, tier]));
    assert.equal(tiers.get("T0")?.structurally_possible, true);
    assert.equal(tiers.get("T0")?.release_ready, true);
    assert.equal(tiers.get("T1")?.structurally_possible, true);
    assert.equal(tiers.get("T1")?.release_ready, true);
    assert.equal(tiers.get("T2")?.structurally_possible, false);
    assert.equal(tiers.get("T2")?.release_ready, false);
  });
});
