/**
 * @freeside/collection-report-gates · deterministic semantic validator
 *
 * Implements the CR-019 rejection matrix (sprint.md §6):
 *   - unknown/missing CRs (including implicit suffixed IDs like "CR-007")
 *   - ranges anywhere a task reference is expected
 *   - expired evidence
 *   - duplicate primary ownership
 *   - impossible branches (state combinations the DAG forbids)
 *   - dependency cycles (tasks and gates)
 *   - premature feature-flag enablement
 *   - tier summaries / checkpoint diagrams that drift from the manifest's
 *     exhaustive transitive closure
 *   - a No-go at CR-000 (G-1) must preserve T0/T1 while making T2 impossible
 *
 * Determinism: expiry is judged against the manifest's own `evaluated_at`
 * (never wall clock); findings are sorted; no randomness, no I/O.
 */

import type {
  GateManifestT,
  GateT,
  RepositoryAcceptanceReceiptT,
  TaskT,
  TierT,
} from "./schema.js";
import {
  STATIC_EVIDENCE_KINDS,
  DYNAMIC_EVIDENCE_KINDS,
} from "./schema.js";
import { isRangeShaped, implicitSuffixVariants, TASK_ID_PATTERN } from "./ids.js";
import {
  computeApprovalManifestDigest,
  expectedApprovalKeyId,
  verifyManifestApproval,
  verifyRepositoryAcceptance,
} from "./approval.js";

// ─────────────────────────────────────────────────────────────────────────────
// Findings
// ─────────────────────────────────────────────────────────────────────────────

export type FindingCode =
  | "RANGE_FORBIDDEN"
  | "IMPLICIT_SUFFIX"
  | "UNKNOWN_CR"
  | "MISSING_CR"
  | "UNKNOWN_GATE"
  | "UNKNOWN_TIER"
  | "DUPLICATE_ID"
  | "DUPLICATE_PRIMARY_OWNERSHIP"
  | "DEPENDENCY_CYCLE"
  | "STATIC_VALIDITY_MISMATCH"
  | "DYNAMIC_VALIDITY_MISMATCH"
  | "MISSING_EXPIRY"
  | "EXPIRED_EVIDENCE"
  | "PASS_WITHOUT_EVIDENCE"
  | "DECISION_WITHOUT_EVIDENCE"
  | "GATE_EVIDENCE_DRIFT"
  | "IMPOSSIBLE_BRANCH"
  | "PREMATURE_FLAG"
  | "NO_GO_TIER_VIOLATION"
  | "TIER_NOT_CLOSED"
  | "TIER_OVERCLAIM"
  | "SUMMARY_NOT_CLOSED"
  | "SUMMARY_OVERCLAIM"
  | "ACCEPTANCE_MISSING"
  | "CHECKPOINT_ORDER_CONTRADICTION"
  | "SOURCE_DIGEST_MISMATCH"
  | "SOURCE_REPO_MISMATCH"
  | "MANIFEST_APPROVAL_MISSING"
  | "MANIFEST_APPROVAL_INVALID"
  | "OWNER_ACCEPTANCE_MISSING"
  | "OWNER_ACCEPTANCE_INVALID"
  | "OWNER_ACCEPTANCE_REJECTED"
  | "TASK_KIND_MISMATCH"
  | "SCHEMA_INVALID";

export interface Finding {
  code: FindingCode;
  path: string;
  message: string;
}

export interface TierReport {
  tier: string;
  /** Structural branch feasibility only; this is never a readiness claim. */
  structurally_possible: boolean;
  /** True only with approved manifest, passed gates, and valid owner receipts. */
  release_ready: boolean;
  blocking_no_go_gates: string[];
  unpassed_gates: string[];
  missing_owner_acceptance: string[];
  closure_size: number;
}

export interface ValidationResult {
  valid: boolean;
  findings: Finding[];
  tiers: TierReport[];
}

const sortFindings = (findings: Finding[]): Finding[] =>
  [...findings].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// ─────────────────────────────────────────────────────────────────────────────
// Raw-document range scan (pre-decode, so ranges get a specific error)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Task-reference positions in the raw YAML document. Descriptions/titles may
 * legitimately quote prose ranges; reference arrays may not.
 */
export function scanRawTaskRefs(raw: unknown): Finding[] {
  const findings: Finding[] = [];
  const check = (value: unknown, path: string): void => {
    if (typeof value !== "string") return;
    if (isRangeShaped(value)) {
      findings.push({
        code: "RANGE_FORBIDDEN",
        path,
        message: `range-shaped task reference "${value}" — the manifest forbids ranges; enumerate every canonical ID explicitly`,
      });
    }
  };
  const checkList = (list: unknown, path: string): void => {
    if (!Array.isArray(list)) return;
    list.forEach((v, i) => check(v, `${path}[${i}]`));
  };
  if (!isRecord(raw)) return findings;
  const doc = raw;

  const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
  tasks.forEach((task, i) => {
    if (isRecord(task)) {
      checkList(task.depends_on, `tasks[${i}].depends_on`);
    }
  });
  const gates = Array.isArray(doc.gates) ? doc.gates : [];
  gates.forEach((gate, i) => {
    if (!isRecord(gate)) return;
    checkList(gate.requires_tasks, `gates[${i}].requires_tasks`);
    const evidence = Array.isArray(gate.evidence) ? gate.evidence : [];
    evidence.forEach((e, j) =>
      isRecord(e)
        ? checkList(
            e.produced_by,
            `gates[${i}].evidence[${j}].produced_by`,
          )
        : undefined,
    );
  });
  const tiers = Array.isArray(doc.tiers) ? doc.tiers : [];
  tiers.forEach((tier, i) => {
    if (!isRecord(tier)) return;
    checkList(tier.entry_tasks, `tiers[${i}].entry_tasks`);
    checkList(tier.tasks, `tiers[${i}].tasks`);
    checkList(tier.acceptance, `tiers[${i}].acceptance`);
    if (isRecord(tier.summary)) {
      checkList(tier.summary.tasks, `tiers[${i}].summary.tasks`);
    }
  });
  const checkpoints = Array.isArray(doc.checkpoints) ? doc.checkpoints : [];
  checkpoints.forEach((checkpoint, i) => {
    if (!isRecord(checkpoint)) return;
    const spine = Array.isArray(checkpoint.serial_spine)
      ? checkpoint.serial_spine
      : [];
    spine.forEach((stage, j) =>
      checkList(stage, `checkpoints[${i}].serial_spine[${j}]`),
    );
    checkList(checkpoint.unlocks, `checkpoints[${i}].unlocks`);
  });
  return sortFindings(findings);
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph helpers
// ─────────────────────────────────────────────────────────────────────────────

const expand = (
  seed: Iterable<string>,
  deps: ReadonlyMap<string, readonly string[]>,
): Set<string> => {
  const out = new Set<string>();
  const stack = [...seed];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const dep of deps.get(id) ?? []) stack.push(dep);
  }
  return out;
};

/** Deterministic cycle detection; returns one representative cycle path per cycle found. */
const findCycles = (
  deps: ReadonlyMap<string, readonly string[]>,
): string[][] => {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const ids = [...deps.keys()].sort();
  for (const id of ids) color.set(id, WHITE);

  const visit = (id: string, path: string[]): void => {
    color.set(id, GRAY);
    path.push(id);
    for (const dep of [...(deps.get(id) ?? [])].sort()) {
      if (!deps.has(dep)) continue; // unknown refs reported elsewhere
      const c = color.get(dep);
      if (c === GRAY) {
        cycles.push([...path.slice(path.indexOf(dep)), dep]);
      } else if (c === WHITE) {
        visit(dep, path);
      }
    }
    path.pop();
    color.set(id, BLACK);
  };
  for (const id of ids) if (color.get(id) === WHITE) visit(id, []);
  return cycles;
};

// ─────────────────────────────────────────────────────────────────────────────
// Source inventory cross-check input
// ─────────────────────────────────────────────────────────────────────────────

export interface SourceInventory {
  /** sha256:<hex> of the coordinator task-manifest bytes. */
  digest: string;
  /** Every task id → owning repo slug, flattened from child_repos[].tasks[]. */
  tasks: ReadonlyMap<string, string>;
  /** Duplicate IDs are retained as findings; the first declaration wins. */
  duplicate_task_ids: readonly string[];
}

export interface ApprovalAuthorityRecord {
  key_id: string;
  public_key: string;
}

export type ApprovalAuthorities = ReadonlyMap<
  string,
  ApprovalAuthorityRecord
>;

export interface RepositoryAcceptanceAuthorityRecord {
  owner: string;
  key_id: string;
  public_key: string;
}

export type RepositoryAcceptanceAuthorities = ReadonlyMap<
  string,
  RepositoryAcceptanceAuthorityRecord
>;

export interface FlattenedTaskManifest {
  tasks: ReadonlyMap<string, string>;
  duplicate_task_ids: readonly string[];
}

/** Flatten source tasks without allowing a duplicate ID to overwrite its first owner. */
export function flattenTaskManifest(raw: unknown): FlattenedTaskManifest {
  const tasksById = new Map<string, string>();
  const duplicateIds = new Set<string>();
  if (!isRecord(raw)) {
    return { tasks: tasksById, duplicate_task_ids: [] };
  }
  const repos = Array.isArray(raw.child_repos) ? raw.child_repos : [];
  for (const repo of repos) {
    if (!isRecord(repo)) continue;
    const slug = typeof repo.slug === "string" ? repo.slug : "";
    const tasks = Array.isArray(repo.tasks) ? repo.tasks : [];
    for (const task of tasks) {
      if (!isRecord(task)) continue;
      const id = typeof task.id === "string" ? task.id : "";
      if (!id) continue;
      if (tasksById.has(id)) {
        duplicateIds.add(id);
      } else {
        tasksById.set(id, slug);
      }
    }
  }
  return {
    tasks: tasksById,
    duplicate_task_ids: [...duplicateIds].sort(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main validator
// ─────────────────────────────────────────────────────────────────────────────

export function validateGateManifest(
  manifest: GateManifestT,
  options: {
    source?: SourceInventory;
    approvalAuthorities?: ApprovalAuthorities;
    acceptanceReceipts?: readonly RepositoryAcceptanceReceiptT[];
    acceptanceAuthorities?: RepositoryAcceptanceAuthorities;
  } = {},
): ValidationResult {
  const findings: Finding[] = [];
  const evaluatedAt = manifest.evaluated_at;

  // ── inventory maps + duplicate detection ─────────────────────────────────
  const taskById = new Map<string, TaskT>();
  manifest.tasks.forEach((task, i) => {
    const prior = taskById.get(task.id);
    if (prior) {
      findings.push(
        prior.primary_owner !== task.primary_owner
          ? {
              code: "DUPLICATE_PRIMARY_OWNERSHIP",
              path: `tasks[${i}].id`,
              message: `${task.id} is declared twice with conflicting primary owners (${prior.primary_owner} vs ${task.primary_owner}) — each CR has exactly one canonical primary owner`,
            }
          : {
              code: "DUPLICATE_ID",
              path: `tasks[${i}].id`,
              message: `duplicate task id ${task.id}`,
            },
      );
      return;
    }
    taskById.set(task.id, task);
  });

  const gateById = new Map<string, GateT>();
  manifest.gates.forEach((gate, i) => {
    if (gateById.has(gate.id)) {
      findings.push({
        code: "DUPLICATE_ID",
        path: `gates[${i}].id`,
        message: `duplicate gate id ${gate.id}`,
      });
      return;
    }
    gateById.set(gate.id, gate);
  });

  const tierById = new Map<string, TierT>();
  manifest.tiers.forEach((tier, i) => {
    if (tierById.has(tier.id)) {
      findings.push({
        code: "DUPLICATE_ID",
        path: `tiers[${i}].id`,
        message: `duplicate tier id ${tier.id}`,
      });
      return;
    }
    tierById.set(tier.id, tier);
  });

  const evidenceIds = new Set<string>();
  manifest.gates.forEach((gate, i) =>
    gate.evidence.forEach((ev, j) => {
      if (evidenceIds.has(ev.id)) {
        findings.push({
          code: "DUPLICATE_ID",
          path: `gates[${i}].evidence[${j}].id`,
          message: `duplicate evidence id ${ev.id}`,
        });
      }
      evidenceIds.add(ev.id);
    }),
  );

  const flagIds = new Set<string>();
  manifest.flags.forEach((flag, i) => {
    if (flagIds.has(flag.id)) {
      findings.push({
        code: "DUPLICATE_ID",
        path: `flags[${i}].id`,
        message: `duplicate flag id ${flag.id}`,
      });
    }
    flagIds.add(flag.id);
  });

  const gateOwners = new Set(manifest.gates.map((gate) => gate.owner));
  const approvalOwners = new Set<string>();
  const approvalManifestDigest = computeApprovalManifestDigest(manifest);
  manifest.approvals.forEach((approval, i) => {
    if (approvalOwners.has(approval.owner)) {
      findings.push({
        code: "DUPLICATE_ID",
        path: `approvals[${i}].owner`,
        message: `duplicate manifest approval from ${approval.owner}`,
      });
    }
    approvalOwners.add(approval.owner);
    if (!gateOwners.has(approval.owner)) {
      findings.push({
        code: "MANIFEST_APPROVAL_MISSING",
        path: `approvals[${i}].owner`,
        message: `${approval.owner} approved the manifest but owns no gate`,
      });
    }
    if (Date.parse(approval.signed_at) > Date.parse(manifest.evaluated_at)) {
      findings.push({
        code: "IMPOSSIBLE_BRANCH",
        path: `approvals[${i}].signed_at`,
        message: `${approval.owner} approval is later than evaluated_at`,
      });
    }
    if (approval.manifest_digest !== approvalManifestDigest) {
      findings.push({
        code: "MANIFEST_APPROVAL_INVALID",
        path: `approvals[${i}].manifest_digest`,
        message: `${approval.owner} approval is not bound to this exact manifest`,
      });
    }
    const authority = options.approvalAuthorities?.get(approval.owner);
    if (authority === undefined) {
      findings.push({
        code: "MANIFEST_APPROVAL_INVALID",
        path: `approvals[${i}].key_id`,
        message: `${approval.owner} has no independently pinned approval key`,
      });
    } else if (
      authority.key_id !== expectedApprovalKeyId(authority.public_key) ||
      approval.key_id !== authority.key_id
    ) {
      findings.push({
        code: "MANIFEST_APPROVAL_INVALID",
        path: `approvals[${i}].key_id`,
        message: `${approval.owner} approval key is not authorized by the pinned owner keyring`,
      });
    } else if (!verifyManifestApproval(approval, authority.public_key)) {
      findings.push({
        code: "MANIFEST_APPROVAL_INVALID",
        path: `approvals[${i}].signature`,
        message: `${approval.owner} approval signature is invalid`,
      });
    }
  });
  if (manifest.status === "owner_approved") {
    const missingOwners = [...gateOwners]
      .filter((owner) => !approvalOwners.has(owner))
      .sort();
    if (missingOwners.length > 0) {
      findings.push({
        code: "MANIFEST_APPROVAL_MISSING",
        path: "approvals",
        message: `owner_approved manifest is missing gate-owner receipts: ${missingOwners.join(", ")}`,
      });
    }
  }

  const acceptedAcceptanceTasks = new Set<string>();
  const rejectedAcceptanceTasks = new Set<string>();
  const invalidAcceptanceTasks = new Set<string>();
  const seenAcceptanceTasks = new Set<string>();
  for (const [i, receipt] of (options.acceptanceReceipts ?? []).entries()) {
    const path = `acceptance_receipts[${i}]`;
    let receiptValid = true;
    if (seenAcceptanceTasks.has(receipt.task_id)) {
      findings.push({
        code: "DUPLICATE_ID",
        path: `${path}.task_id`,
        message: `duplicate repository-owner acceptance receipt for ${receipt.task_id}`,
      });
      receiptValid = false;
    }
    seenAcceptanceTasks.add(receipt.task_id);

    const task = taskById.get(receipt.task_id);
    if (task === undefined || task.kind !== "acceptance") {
      findings.push({
        code: "OWNER_ACCEPTANCE_INVALID",
        path: `${path}.task_id`,
        message: `${receipt.task_id} is not a declared repository acceptance task`,
      });
      receiptValid = false;
    } else {
      if (receipt.repository !== task.repository) {
        findings.push({
          code: "OWNER_ACCEPTANCE_INVALID",
          path: `${path}.repository`,
          message: `${receipt.task_id} is for ${task.repository}, not ${receipt.repository}`,
        });
        receiptValid = false;
      }
      if (receipt.owner !== task.primary_owner) {
        findings.push({
          code: "OWNER_ACCEPTANCE_INVALID",
          path: `${path}.owner`,
          message: `${receipt.task_id} must be signed by repository owner ${task.primary_owner}, not ${receipt.owner}`,
        });
        receiptValid = false;
      }
    }

    const expectedArtifactUri =
      `https://github.com/${receipt.repository}/tree/${receipt.reviewed_commit}`;
    if (receipt.artifact_uri !== expectedArtifactUri) {
      findings.push({
        code: "OWNER_ACCEPTANCE_INVALID",
        path: `${path}.artifact_uri`,
        message: `artifact_uri must bind the same repository and reviewed_commit as the receipt`,
      });
      receiptValid = false;
    }

    const validFrom = Date.parse(receipt.valid_from);
    const validUntil = Date.parse(receipt.valid_until);
    const evaluated = Date.parse(evaluatedAt);
    if (validFrom >= validUntil) {
      findings.push({
        code: "OWNER_ACCEPTANCE_INVALID",
        path: `${path}.valid_until`,
        message: `repository acceptance validity must end after it begins`,
      });
      receiptValid = false;
    } else if (evaluated < validFrom || evaluated >= validUntil) {
      findings.push({
        code: "OWNER_ACCEPTANCE_INVALID",
        path: `${path}.valid_until`,
        message: `repository acceptance is not valid at evaluated_at ${evaluatedAt}`,
      });
      receiptValid = false;
    }

    const authority = options.acceptanceAuthorities?.get(receipt.repository);
    if (authority === undefined) {
      findings.push({
        code: "OWNER_ACCEPTANCE_INVALID",
        path: `${path}.key_id`,
        message: `${receipt.repository} has no independently pinned repository acceptance key`,
      });
      receiptValid = false;
    } else if (
      authority.owner !== receipt.owner ||
      authority.key_id !== expectedApprovalKeyId(authority.public_key) ||
      receipt.key_id !== authority.key_id
    ) {
      findings.push({
        code: "OWNER_ACCEPTANCE_INVALID",
        path: `${path}.key_id`,
        message: `${receipt.task_id} key is not authorized for ${receipt.repository} owner ${receipt.owner}`,
      });
      receiptValid = false;
    } else if (!verifyRepositoryAcceptance(receipt, authority.public_key)) {
      findings.push({
        code: "OWNER_ACCEPTANCE_INVALID",
        path: `${path}.signature`,
        message: `${receipt.task_id} repository acceptance signature is invalid`,
      });
      receiptValid = false;
    }

    if (receiptValid) {
      if (receipt.state === "accepted") {
        acceptedAcceptanceTasks.add(receipt.task_id);
      } else {
        rejectedAcceptanceTasks.add(receipt.task_id);
      }
    } else {
      invalidAcceptanceTasks.add(receipt.task_id);
    }
  }
  for (const taskId of invalidAcceptanceTasks) {
    acceptedAcceptanceTasks.delete(taskId);
    rejectedAcceptanceTasks.delete(taskId);
  }

  const knownTaskIds = new Set(taskById.keys());

  // ── task-reference resolution ────────────────────────────────────────────
  const checkTaskRef = (
    ref: string,
    path: string,
    expectedKind?: TaskT["kind"],
  ): void => {
    const task = taskById.get(ref);
    if (task !== undefined) {
      if (expectedKind !== undefined && task.kind !== expectedKind) {
        findings.push({
          code: "TASK_KIND_MISMATCH",
          path,
          message: `${ref} is kind ${task.kind}; this position requires ${expectedKind}`,
        });
      }
      return;
    }
    const variants = implicitSuffixVariants(ref, knownTaskIds);
    if (variants) {
      findings.push({
        code: "IMPLICIT_SUFFIX",
        path,
        message: `${ref} does not exist as a canonical ID — suffixed IDs are explicit; did you mean ${variants.join(" / ")}?`,
      });
    } else {
      findings.push({
        code: "UNKNOWN_CR",
        path,
        message: `unknown task reference ${ref} — not in the canonical CR inventory`,
      });
    }
  };
  const checkGateRef = (ref: string, path: string): void => {
    if (!gateById.has(ref)) {
      findings.push({
        code: "UNKNOWN_GATE",
        path,
        message: `unknown gate reference ${ref}`,
      });
    }
  };

  manifest.tasks.forEach((task, i) =>
    task.depends_on.forEach((dep, j) =>
      checkTaskRef(dep, `tasks[${i}].depends_on[${j}]`, "cr"),
    ),
  );
  manifest.gates.forEach((gate, i) => {
    gate.requires_tasks.forEach((ref, j) =>
      checkTaskRef(ref, `gates[${i}].requires_tasks[${j}]`, "cr"),
    );
    gate.evidence.forEach((ev, j) =>
      ev.produced_by.forEach((ref, k) =>
        checkTaskRef(
          ref,
          `gates[${i}].evidence[${j}].produced_by[${k}]`,
          "cr",
        ),
      ),
    );
    gate.depends_on_gates.forEach((ref, j) =>
      checkGateRef(ref, `gates[${i}].depends_on_gates[${j}]`),
    );
    if (gate.on_no_go) {
      [...gate.on_no_go.closes_tiers, ...gate.on_no_go.preserves_tiers].forEach(
        (tierId) => {
          if (!tierById.has(tierId)) {
            findings.push({
              code: "UNKNOWN_TIER",
              path: `gates[${i}].on_no_go`,
              message: `unknown tier reference ${tierId}`,
            });
          }
        },
      );
    }
  });
  manifest.tiers.forEach((tier, i) => {
    tier.requires_gates.forEach((ref, j) =>
      checkGateRef(ref, `tiers[${i}].requires_gates[${j}]`),
    );
    tier.tasks.forEach((ref, j) =>
      checkTaskRef(ref, `tiers[${i}].tasks[${j}]`, "cr"),
    );
    tier.entry_tasks.forEach((ref, j) =>
      checkTaskRef(ref, `tiers[${i}].entry_tasks[${j}]`, "cr"),
    );
    tier.acceptance.forEach((ref, j) =>
      checkTaskRef(ref, `tiers[${i}].acceptance[${j}]`, "acceptance"),
    );
    tier.summary.gates.forEach((ref, j) =>
      checkGateRef(ref, `tiers[${i}].summary.gates[${j}]`),
    );
    tier.summary.tasks.forEach((ref, j) =>
      checkTaskRef(ref, `tiers[${i}].summary.tasks[${j}]`, "cr"),
    );
  });
  manifest.checkpoints.forEach((cp, i) => {
    cp.serial_spine.forEach((stage, j) =>
      stage.forEach((ref, k) =>
        checkTaskRef(
          ref,
          `checkpoints[${i}].serial_spine[${j}][${k}]`,
          "cr",
        ),
      ),
    );
    cp.unlocks.forEach((ref, j) =>
      checkTaskRef(ref, `checkpoints[${i}].unlocks[${j}]`, "cr"),
    );
  });
  manifest.flags.forEach((flag, i) => {
    flag.controlled_by_gates.forEach((ref, j) =>
      checkGateRef(ref, `flags[${i}].controlled_by_gates[${j}]`),
    );
    if (flag.tier !== undefined && !tierById.has(flag.tier)) {
      findings.push({
        code: "UNKNOWN_TIER",
        path: `flags[${i}].tier`,
        message: `unknown tier reference ${flag.tier}`,
      });
    }
  });

  // ── dependency cycles ────────────────────────────────────────────────────
  const taskDeps = new Map<string, readonly string[]>(
    [...taskById.values()].map((t) => [t.id, t.depends_on]),
  );
  for (const cycle of findCycles(taskDeps)) {
    findings.push({
      code: "DEPENDENCY_CYCLE",
      path: "tasks",
      message: `task dependency cycle: ${cycle.join(" -> ")}`,
    });
  }
  const gateDeps = new Map<string, readonly string[]>(
    [...gateById.values()].map((g) => [g.id, g.depends_on_gates]),
  );
  for (const cycle of findCycles(gateDeps)) {
    findings.push({
      code: "DEPENDENCY_CYCLE",
      path: "gates",
      message: `gate dependency cycle: ${cycle.join(" -> ")}`,
    });
  }

  // ── evidence validity + expiry (judged against evaluated_at) ─────────────
  const staticKinds = new Set<string>(STATIC_EVIDENCE_KINDS);
  const dynamicKinds = new Set<string>(DYNAMIC_EVIDENCE_KINDS);
  const gateHasExpiredEvidence = new Map<string, boolean>();

  manifest.gates.forEach((gate, i) => {
    let expired = false;
    gate.evidence.forEach((ev, j) => {
      const path = `gates[${i}].evidence[${j}]`;
      const isDynamicValidity = "max_age_days" in ev.validity;
      const isSuperseded =
        !isDynamicValidity && ev.validity.valid_until === "superseded";
      if (staticKinds.has(ev.kind) && !isSuperseded) {
        findings.push({
          code: "STATIC_VALIDITY_MISMATCH",
          path,
          message: `${ev.id}: static ${ev.kind} evidence must declare valid_until: superseded`,
        });
      }
      if (dynamicKinds.has(ev.kind) && isSuperseded) {
        findings.push({
          code: "DYNAMIC_VALIDITY_MISMATCH",
          path,
          message: `${ev.id}: dynamic ${ev.kind} evidence must declare an explicit expiry and renewal owner, not valid_until: superseded`,
        });
      }
      if (
        ev.recorded_at !== undefined &&
        Date.parse(ev.recorded_at) > Date.parse(evaluatedAt)
      ) {
        findings.push({
          code: "IMPOSSIBLE_BRANCH",
          path,
          message: `${ev.id}: recorded_at ${ev.recorded_at} is after evaluated_at ${evaluatedAt}`,
        });
      }
      if (isDynamicValidity) {
        const validUntil = ev.validity.valid_until;
        if (ev.recorded_at !== undefined && validUntil === undefined) {
          findings.push({
            code: "MISSING_EXPIRY",
            path,
            message: `${ev.id}: recorded dynamic evidence must carry a concrete valid_until expiry`,
          });
        }
        if (ev.recorded_at === undefined && validUntil !== undefined) {
          findings.push({
            code: "DYNAMIC_VALIDITY_MISMATCH",
            path,
            message: `${ev.id}: unrecorded dynamic evidence must declare max_age_days but cannot invent an absolute valid_until`,
          });
        }
        if (
          ev.recorded_at !== undefined &&
          validUntil !== undefined &&
          Date.parse(validUntil) <= Date.parse(ev.recorded_at)
        ) {
          findings.push({
            code: "IMPOSSIBLE_BRANCH",
            path,
            message: `${ev.id}: valid_until ${validUntil} must be after recorded_at ${ev.recorded_at}`,
          });
        }
        if (ev.recorded_at !== undefined && validUntil !== undefined) {
          const maximumValidity =
            Date.parse(ev.recorded_at) +
            ev.validity.max_age_days * 24 * 60 * 60 * 1_000;
          if (Date.parse(validUntil) > maximumValidity) {
            findings.push({
              code: "DYNAMIC_VALIDITY_MISMATCH",
              path,
              message: `${ev.id}: valid_until exceeds the ratified max_age_days policy`,
            });
          }
        }
        if (
          validUntil !== undefined &&
          Date.parse(validUntil) <= Date.parse(evaluatedAt)
        ) {
          expired = true;
          if (gate.state === "pass" || gate.state === "pending") {
            findings.push({
              code: "EXPIRED_EVIDENCE",
              path,
              message: `${ev.id}: evidence expired at ${validUntil} (evaluated_at ${evaluatedAt}); gate ${gate.id} state "${gate.state}" is dishonest — it must be expired`,
            });
          }
        }
      }
    });
    gateHasExpiredEvidence.set(gate.id, expired);
  });

  // ── gate state consistency (impossible branches) ─────────────────────────
  manifest.gates.forEach((gate, i) => {
    const path = `gates[${i}]`;
    const depStates = gate.depends_on_gates
      .map((id) => gateById.get(id))
      .filter((g): g is GateT => g !== undefined);

    if (gate.state === "pass") {
      const failedDeps = depStates.filter((g) => g.state !== "pass");
      for (const dep of failedDeps) {
        findings.push({
          code: "IMPOSSIBLE_BRANCH",
          path,
          message: `gate ${gate.id} is pass while dependency gate ${dep.id} is ${dep.state} — a gate cannot pass over an unpassed dependency`,
        });
      }
      const unrecorded = gate.evidence.filter((ev) => ev.recorded_at === undefined);
      for (const ev of unrecorded) {
        findings.push({
          code: "PASS_WITHOUT_EVIDENCE",
          path,
          message: `gate ${gate.id} is pass but evidence ${ev.id} has never been recorded (no recorded_at)`,
        });
      }
    }
    if (gate.state === "no_go") {
      const missingDecisionEvidence = gate.evidence.filter(
        (evidence) => evidence.recorded_at === undefined,
      );
      for (const evidence of missingDecisionEvidence) {
        findings.push({
          code: "DECISION_WITHOUT_EVIDENCE",
          path,
          message: `gate ${gate.id} is no_go but evidence ${evidence.id} has never been recorded`,
        });
      }
      if (gateHasExpiredEvidence.get(gate.id) === true) {
        findings.push({
          code: "DECISION_WITHOUT_EVIDENCE",
          path,
          message: `gate ${gate.id} is no_go using evidence expired at evaluated_at ${evaluatedAt}`,
        });
      }
    }
    if (manifest.status === "pending_owner_approval" && gate.state !== "pending") {
      findings.push({
        code: "IMPOSSIBLE_BRANCH",
        path,
        message: `gate ${gate.id} is ${gate.state} while the manifest itself is pending owner approval`,
      });
    }
    const terminalDependencies = depStates.filter(
      (dependency) =>
        dependency.state === "no_go" || dependency.state === "expired",
    );
    if (gate.state === "pending" && terminalDependencies.length > 0) {
      findings.push({
        code: "IMPOSSIBLE_BRANCH",
        path,
        message: `gate ${gate.id} is pending despite terminal dependency state: ${terminalDependencies
          .map((dependency) => `${dependency.id}=${dependency.state}`)
          .join(", ")}; dependent work must be blocked`,
      });
    }
    if (gate.state === "no_go" && gate.on_no_go === undefined) {
      findings.push({
        code: "IMPOSSIBLE_BRANCH",
        path,
        message: `gate ${gate.id} is no_go but declares no on_no_go consequences — only gates with go/no-go semantics may be no_go`,
      });
    }
    if (gate.state === "blocked") {
      const blockingDep = depStates.some((g) => g.state !== "pass");
      if (!blockingDep) {
        findings.push({
          code: "IMPOSSIBLE_BRANCH",
          path,
          message: `gate ${gate.id} is blocked but every dependency gate is pass — blocked requires an unpassed dependency`,
        });
      }
    }
    if (gate.state === "expired" && gateHasExpiredEvidence.get(gate.id) !== true) {
      findings.push({
        code: "IMPOSSIBLE_BRANCH",
        path,
        message: `gate ${gate.id} is expired but no evidence item has expired relative to evaluated_at`,
      });
    }

    const requiredTasks = new Set(gate.requires_tasks);
    const evidenceTasks = new Set(
      gate.evidence.flatMap((evidence) => evidence.produced_by),
    );
    const uncovered = [...requiredTasks]
      .filter((task) => !evidenceTasks.has(task))
      .sort();
    const undeclared = [...evidenceTasks]
      .filter((task) => !requiredTasks.has(task))
      .sort();
    if (uncovered.length > 0 || undeclared.length > 0) {
      findings.push({
        code: "GATE_EVIDENCE_DRIFT",
        path,
        message: `gate ${gate.id} task/evidence drift — required without evidence: ${
          uncovered.join(", ") || "none"
        }; evidence producers not required by gate: ${undeclared.join(", ") || "none"}`,
      });
    }
  });

  // ── tier closure + summary validation ────────────────────────────────────
  const gateTransitive = (seedGates: readonly string[]): Set<string> =>
    expand(
      seedGates.filter((id) => gateById.has(id)),
      gateDeps,
    );

  const tierClosure = new Map<string, Set<string>>();
  const tierMissingAcceptance = new Map<string, string[]>();
  const acceptanceBlockingTiers = new Map<string, Set<string>>();
  const orderedTiers = [...manifest.tiers].sort(
    (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)),
  );

  orderedTiers.forEach((tier) => {
    const i = manifest.tiers.indexOf(tier);
    const allGates = gateTransitive(tier.requires_gates);
    const seed = new Set<string>();
    for (const lower of orderedTiers) {
      if (Number(lower.id.slice(1)) > Number(tier.id.slice(1))) continue;
      for (const task of lower.entry_tasks) {
        if (knownTaskIds.has(task)) seed.add(task);
      }
    }
    for (const gid of allGates) {
      for (const t of gateById.get(gid)?.requires_tasks ?? []) {
        if (knownTaskIds.has(t)) seed.add(t);
      }
    }
    const closure = expand(seed, taskDeps);
    tierClosure.set(tier.id, closure);

    const declared = new Set(tier.tasks);
    const missing = [...closure].filter((id) => !declared.has(id)).sort();
    if (missing.length > 0) {
      findings.push({
        code: "TIER_NOT_CLOSED",
        path: `tiers[${i}].tasks`,
        message: `tier ${tier.id} task list is not the exhaustive transitive closure — missing: ${missing.join(", ")}`,
      });
    }
    const extraneous = [...declared].filter((id) => !closure.has(id)).sort();
    if (extraneous.length > 0) {
      findings.push({
        code: "TIER_OVERCLAIM",
        path: `tiers[${i}].tasks`,
        message: `tier ${tier.id} task list contains tasks outside its independently computed closure: ${extraneous.join(", ")}`,
      });
    }

    // Summary validation: the labeled human row (this tier plus lower tiers,
    // plus the literal evidence lists of the gates those rows name) must
    // cover the exhaustive closure WITHOUT dependency expansion. This is the
    // check that catches the Flatline T0/G2A finding: the sprint tier table
    // omits CR-002 even though T0's closure requires it via CR-007A.
    const covered = new Set<string>();
    for (const lower of orderedTiers) {
      if (Number(lower.id.slice(1)) > Number(tier.id.slice(1))) continue;
      for (const t of lower.summary.tasks) covered.add(t);
      for (const t of lower.acceptance) covered.add(t);
      for (const gid of lower.summary.gates) {
        for (const t of gateById.get(gid)?.requires_tasks ?? []) covered.add(t);
      }
    }
    const summaryMissing = [...closure].filter((id) => !covered.has(id)).sort();
    if (summaryMissing.length > 0) {
      findings.push({
        code: "SUMMARY_NOT_CLOSED",
        path: `tiers[${i}].summary`,
        message: `tier ${tier.id} summary does not cover its exhaustive transitive closure — missing: ${summaryMissing.join(", ")} (summaries cannot authorize a release; fix the summary or the closure)`,
      });
    }
    const overclaim = tier.summary.tasks
      .filter((id) => knownTaskIds.has(id) && !closure.has(id))
      .sort();
    if (overclaim.length > 0) {
      findings.push({
        code: "SUMMARY_OVERCLAIM",
        path: `tiers[${i}].summary`,
        message: `tier ${tier.id} summary claims tasks outside its transitive closure: ${overclaim.join(", ")}`,
      });
    }

    // Acceptance coverage: every repo owning a CR in the closure must have
    // its boundary-acceptance task listed (sprint.md §13 — an unaccepted
    // boundary remains blocked).
    const acceptanceRepos = new Set(
      tier.acceptance
        .map((id) => taskById.get(id))
        .filter((t): t is TaskT => t !== undefined && t.kind === "acceptance")
        .map((t) => t.repository),
    );
    const closureRepos = new Set(
      [...closure]
        .map((id) => taskById.get(id))
        .filter((t): t is TaskT => t !== undefined && t.kind === "cr")
        .map((t) => t.repository),
    );
    const unaccepted = [...closureRepos].filter((r) => !acceptanceRepos.has(r)).sort();
    if (unaccepted.length > 0) {
      findings.push({
        code: "ACCEPTANCE_MISSING",
        path: `tiers[${i}].acceptance`,
        message: `tier ${tier.id} closure spans repositories without a boundary-acceptance task: ${unaccepted.join(", ")}`,
      });
    }

    const missingOwnerAcceptance = tier.acceptance
      .filter((taskId) => !acceptedAcceptanceTasks.has(taskId))
      .sort();
    tierMissingAcceptance.set(tier.id, missingOwnerAcceptance);
    const everyGatePassed = [...allGates].every(
      (gateId) => gateById.get(gateId)?.state === "pass",
    );
    if (manifest.status === "owner_approved" && everyGatePassed) {
      for (const taskId of missingOwnerAcceptance) {
        const blockedTiers =
          acceptanceBlockingTiers.get(taskId) ?? new Set<string>();
        blockedTiers.add(tier.id);
        acceptanceBlockingTiers.set(taskId, blockedTiers);
      }
    }
  });

  for (const [taskId, blockedTiers] of [...acceptanceBlockingTiers.entries()].sort()) {
    const rejected = rejectedAcceptanceTasks.has(taskId);
    findings.push({
      code: rejected
        ? "OWNER_ACCEPTANCE_REJECTED"
        : "OWNER_ACCEPTANCE_MISSING",
      path: "acceptance_receipts",
      message: `${taskId} ${
        rejected ? "is explicitly rejected" : "has no current, valid repository-owner receipt"
      }; release-ready tiers blocked: ${[...blockedTiers].sort().join(", ")}`,
    });
  }

  // ── no-go consequences (structural + live) ───────────────────────────────
  manifest.gates.forEach((gate, i) => {
    if (!gate.on_no_go) return;
    const path = `gates[${i}].on_no_go`;
    for (const tierId of gate.on_no_go.closes_tiers) {
      const tier = tierById.get(tierId);
      if (!tier) continue;
      if (!gateTransitive(tier.requires_gates).has(gate.id)) {
        findings.push({
          code: "NO_GO_TIER_VIOLATION",
          path,
          message: `gate ${gate.id} claims a no_go closes tier ${tierId}, but ${tierId} does not require ${gate.id} — the closure is not enforceable`,
        });
      }
    }
    for (const tierId of gate.on_no_go.preserves_tiers) {
      const tier = tierById.get(tierId);
      if (!tier) continue;
      if (gateTransitive(tier.requires_gates).has(gate.id)) {
        findings.push({
          code: "NO_GO_TIER_VIOLATION",
          path,
          message: `gate ${gate.id} claims a no_go preserves tier ${tierId}, but ${tierId} requires ${gate.id} — a no_go would close it`,
        });
      }
    }
    if (gate.state === "no_go") {
      const closed = new Set(gate.on_no_go.closes_tiers);
      manifest.flags.forEach((flag, j) => {
        if (flag.enabled && flag.tier !== undefined && closed.has(flag.tier)) {
          findings.push({
            code: "NO_GO_TIER_VIOLATION",
            path: `flags[${j}]`,
            message: `flag ${flag.id} is enabled for tier ${flag.tier}, which is impossible while gate ${gate.id} is no_go`,
          });
        }
      });
    }
  });

  // ── premature flag enablement ────────────────────────────────────────────
  manifest.flags.forEach((flag, i) => {
    if (!flag.enabled) return;
    if (flag.tier === undefined) {
      findings.push({
        code: "PREMATURE_FLAG",
        path: `flags[${i}].tier`,
        message: `enabled flag ${flag.id} must name a release tier so repository-owner acceptance can be enforced`,
      });
    }
    if (manifest.status !== "owner_approved") {
      findings.push({
        code: "PREMATURE_FLAG",
        path: `flags[${i}]`,
        message: `flag ${flag.id} is enabled before the manifest is owner_approved`,
      });
    }
    const notPassed = flag.controlled_by_gates
      .map((id) => gateById.get(id))
      .filter((g): g is GateT => g !== undefined && g.state !== "pass")
      .map((g) => `${g.id}=${g.state}`);
    if (notPassed.length > 0) {
      findings.push({
        code: "PREMATURE_FLAG",
        path: `flags[${i}]`,
        message: `flag ${flag.id} is enabled before its controlling gates pass: ${notPassed.join(", ")}`,
      });
    }
    const missingAcceptance =
      flag.tier === undefined
        ? []
        : (tierMissingAcceptance.get(flag.tier) ?? []);
    if (missingAcceptance.length > 0) {
      findings.push({
        code: "PREMATURE_FLAG",
        path: `flags[${i}]`,
        message: `flag ${flag.id} is enabled without current, valid repository-owner acceptance for tier ${flag.tier}: ${missingAcceptance.join(", ")}`,
      });
    }
  });

  // ── checkpoint diagrams vs the DAG ───────────────────────────────────────
  const taskClosureCache = new Map<string, Set<string>>();
  const taskClosure = (id: string): Set<string> => {
    let c = taskClosureCache.get(id);
    if (!c) {
      c = expand(taskDeps.get(id) ?? [], taskDeps);
      taskClosureCache.set(id, c);
    }
    return c;
  };

  manifest.checkpoints.forEach((cp, i) => {
    const stages = cp.serial_spine.map((stage) =>
      stage.filter((id) => knownTaskIds.has(id)),
    );
    for (let j = 1; j < stages.length; j++) {
      for (const b of stages[j]) {
        const dependsOnPrev = stages[j - 1].some((a) => taskClosure(b).has(a));
        if (!dependsOnPrev) {
          findings.push({
            code: "CHECKPOINT_ORDER_CONTRADICTION",
            path: `checkpoints[${i}].serial_spine[${j}]`,
            message: `checkpoint ${cp.id}: ${b} has no dependency path to the previous serial stage (${stages[j - 1].join(", ")}) — the spine does not follow the manifest DAG`,
          });
        }
      }
    }
    // reverse contradiction: an earlier stage task depending on a later one
    for (let j = 0; j < stages.length; j++) {
      for (let k = j + 1; k < stages.length; k++) {
        for (const a of stages[j]) {
          for (const b of stages[k]) {
            if (taskClosure(a).has(b)) {
              findings.push({
                code: "CHECKPOINT_ORDER_CONTRADICTION",
                path: `checkpoints[${i}].serial_spine[${j}]`,
                message: `checkpoint ${cp.id}: ${a} is scheduled before ${b} but transitively depends on it — impossible order`,
              });
            }
          }
        }
      }
    }
  });

  // ── source inventory cross-check (unknown vs missing CRs) ────────────────
  if (options.source) {
    const {
      digest,
      tasks: sourceTasks,
      duplicate_task_ids: duplicateTaskIds,
    } = options.source;
    for (const taskId of duplicateTaskIds) {
      findings.push({
        code: "DUPLICATE_ID",
        path: "source.tasks",
        message: `coordinator task-manifest declares ${taskId} more than once; duplicate IDs cannot overwrite canonical ownership`,
      });
    }
    if (digest !== manifest.source.task_manifest_digest) {
      findings.push({
        code: "SOURCE_DIGEST_MISMATCH",
        path: "source.task_manifest_digest",
        message: `manifest records ${manifest.source.task_manifest_digest} but the provided task-manifest hashes to ${digest} — regenerate or re-ratify the inventory`,
      });
    }
    for (const [id, repo] of [...sourceTasks.entries()].sort()) {
      const task = taskById.get(id);
      if (!task) {
        findings.push({
          code: "MISSING_CR",
          path: "tasks",
          message: `canonical task ${id} (${repo}) from the coordinator task-manifest is missing from the gate manifest`,
        });
      } else if (task.repository !== repo) {
        findings.push({
          code: "SOURCE_REPO_MISMATCH",
          path: "tasks",
          message: `${id} is owned by ${repo} in the coordinator task-manifest but ${task.repository} in the gate manifest`,
        });
      }
    }
    for (const id of [...taskById.keys()].sort()) {
      if (!sourceTasks.has(id)) {
        findings.push({
          code: "UNKNOWN_CR",
          path: "tasks",
          message: `${id} is not in the coordinator task-manifest — the gate manifest cannot invent canonical tasks`,
        });
      }
    }
  }

  // ── tier feasibility/readiness report ───────────────────────────────────
  const tierReports: TierReport[] = orderedTiers.map((tier) => {
    const gates = gateTransitive(tier.requires_gates);
    const noGo = [...gates]
      .filter((id) => gateById.get(id)?.state === "no_go")
      .sort();
    const unpassed = [...gates]
      .filter((id) => gateById.get(id)?.state !== "pass")
      .map((id) => `${id}=${gateById.get(id)?.state ?? "unknown"}`)
      .sort();
    const missingAcceptance = tierMissingAcceptance.get(tier.id) ?? [];
    const structurallyPossible = noGo.length === 0;
    return {
      tier: tier.id,
      structurally_possible: structurallyPossible,
      release_ready:
        findings.length === 0 &&
        structurallyPossible &&
        manifest.status === "owner_approved" &&
        unpassed.length === 0 &&
        missingAcceptance.length === 0,
      blocking_no_go_gates: noGo,
      unpassed_gates: unpassed,
      missing_owner_acceptance: missingAcceptance,
      closure_size: tierClosure.get(tier.id)?.size ?? 0,
    };
  });

  const sorted = sortFindings(findings);
  return { valid: sorted.length === 0, findings: sorted, tiers: tierReports };
}

/** True when a string is a plausible single canonical task ID (shape only). */
export const isCanonicalTaskId = (s: string): boolean => TASK_ID_PATTERN.test(s);
