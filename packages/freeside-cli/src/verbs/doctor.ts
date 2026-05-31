/**
 * `loa freeside doctor` — audit every registered freeside-* building's beacon.
 *
 * The enforcement point for the network's awareness surface (SDD cycle
 * doctor-acvp-network-plane §3). Per registry module:
 *   1. Resolve the beacon (FIXTURE-FIRST, OD-1; --remote → beacon_unreachable, SC-6)
 *   2. Validate against BeaconV3 (clean V2 decode → beacon_legacy_v2 warn, A.4)
 *   3. cycle_state freshness (next_review vs injected `now`; 180-day window)
 *   4. composes_with: unknown-sibling (error) + tag_hash_unverified (warn, OD-2)
 *   5. sealed_schemas: recompute sha256(JCS(schema)) and compare to declared hash
 *   6. ACVP binding sub-check (validateAcvpBindings, folded in)
 *   7. Aggregate → DoctorReport (bin exits 1 if summary.error > 0)
 *
 * doctor AUDITS; it does NOT emit /.well-known/beacon.json (SC-3 — that is
 * build-beacon-json's job). Pure helpers (checkCycleState / checkComposesWith /
 * recomputeSealedHash / checkSealedSchemas) take already-read inputs and are
 * unit-tested without fs/git. The impure resolvers (git show, file reads) live
 * in the async orchestrator.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { execFileSync } from "node:child_process";
import {
  loadRegistry,
  loadBeacon,
  loadBeaconFromText,
  type Registry,
} from "@freeside/freeside-registry";
import {
  validateBeaconV3,
  validateAcvpBindings,
  type BeaconV3,
  type AcvpAllowlistEntry,
  type AcvpProofReceipt,
} from "@freeside/beacon-schema";
import { jcsCanonicalize, sha256Hex } from "../lib/jcs.js";

export type Severity = "ok" | "warn" | "error";

/**
 * Stable, downstream-facing check IDs (FL-HC5 — enumerate, do not scatter).
 * The two `acvp_*` checks carry the invariant id as a suffix.
 */
export type DoctorCheck =
  | "beacon_deferred"
  | "beacon_unreachable"
  | "beacon_invalid"
  | "beacon_legacy_v2"
  | "beacon_valid"
  | "beacon_auth_required"
  | "cycle_review_overdue"
  | "cycle_review_window_exceeded"
  | "compose_unknown_sibling"
  | "tag_hash_unverified"
  | "sealed_schema_ok"
  | "sealed_schema_hash_drift"
  | "sealed_schema_unverified"
  | `acvp_proof:${string}`
  | `acvp_runtime:${string}`;

export interface DoctorFinding {
  readonly slug: string;
  readonly check: DoctorCheck;
  readonly severity: Severity;
  readonly message: string;
}

export interface DoctorReport {
  readonly checked_at: string;
  readonly modules_checked: number;
  readonly findings: ReadonlyArray<DoctorFinding>;
  readonly summary: { ok: number; warn: number; error: number };
}

export interface DoctorOptions {
  /** fetch live beacon_url instead of fixture (SC-6: returns beacon_unreachable this build) */
  readonly remote?: boolean;
  /** prior registry for the visibility-transition guard (SC: not wired this build) */
  readonly baselineRegistryPath?: string;
  /** test/CI override: registry file to audit (default = registry package's registry.yaml) */
  readonly registryPath?: string;
  /** operator-owned aspirational allowlist (default .freeside/acvp-aspirational-allowlist.yaml from cwd) */
  readonly allowlistPath?: string;
  /** injected for determinism (FL-D0 / G-7) */
  readonly now?: Date;
  /** --acvp: run ONLY beacon-resolve + the ACVP binding sub-check; skip
   *  cycle/compose/sealed so the report-only ACVP CI reflects binding scope (FAGAN). */
  readonly acvpOnly?: boolean;
  /**
   * --cells-dir: directory holding per-cell git clones as `<cellsDir>/cell-<slug>/`
   * (the cluster-compliance clone convention). When set, doctor resolves each
   * module's beacon + ACVP inputs (eventsPin · proof receipts · HEAD · proof
   * freshness) FROM the clone — the per-cell resolution bridge (sprint-400
   * step 3) that makes receipts actually consumed and backed buildings report
   * `bound`. Unset (or a clone absent) → unchanged fixture/null posture. */
  readonly cellsDir?: string;
}

const ALL_ZEROS_64 = "0".repeat(64);
const SHA256_RE = /^[a-f0-9]{64}$/;

/** reject absolute paths + `..` traversal (path-component discipline). */
function relPathSafe(p: string): boolean {
  if (!p || p.startsWith("/")) return false;
  return !p.split(/[\\/]/).some((seg) => seg === "..");
}

/**
 * Resolve a root-relative path with symlink-escape defense (FAGAN gpt+opus):
 * reject `..`/absolute, then realpath BOTH root and candidate and require
 * containment — so a symlink inside the module cannot make an OUTSIDE file
 * count as a valid proof/schema artifact. Returns the realpath, or null when
 * the path is unsafe, escapes the root, or does not exist.
 */
function safeResolve(root: string, rel: string): string | null {
  if (!relPathSafe(rel)) return null;
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(join(realRoot, rel));
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
    return real;
  } catch {
    return null; // unresolvable / does not exist
  }
}

// ── pure helper: cycle_state freshness (SDD §3.3) ───────────────────────────
export function checkCycleState(
  slug: string,
  beacon: BeaconV3,
  now: Date,
): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const cs = beacon.cycle_state;
  const today = now.toISOString().slice(0, 10);
  if (cs.next_review < today) {
    out.push({
      slug, check: "cycle_review_overdue", severity: "warn",
      message: `cycle_state.next_review ${cs.next_review} is in the past (today ${today}) — review overdue`,
    });
  }
  // next_review − since must be ≤ 180 days (ADR-007:379)
  const since = Date.parse(cs.since + "T00:00:00Z");
  const next = Date.parse(cs.next_review + "T00:00:00Z");
  if (Number.isFinite(since) && Number.isFinite(next)) {
    const days = (next - since) / 86_400_000;
    if (days > 180) {
      out.push({
        slug, check: "cycle_review_window_exceeded", severity: "error",
        message: `cycle_state review window ${Math.round(days)}d exceeds the 180-day max (since ${cs.since} → next_review ${cs.next_review})`,
      });
    }
  }
  return out;
}

// ── pure helper: composes_with edges (SDD §3.4) ─────────────────────────────
export function checkComposesWith(
  slug: string,
  beacon: BeaconV3,
  registry: Registry,
): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const edges = beacon.composes_with ?? {};
  for (const [siblingKey, edge] of Object.entries(edges)) {
    // (a) the key MUST resolve to a registered module slug (ADR-007 A.2:350).
    //     `outer:` deps are admitted by the schema but are not cells → skip the
    //     registry-membership check for them (their *-api surface hasn't shipped).
    if (siblingKey.startsWith("outer:")) {
      out.push({
        slug, check: "tag_hash_unverified", severity: "warn",
        message: `composes_with '${siblingKey}' is an outer: dep (${(edge as { tag?: string }).tag ?? "?"}) — tag hash recompute deferred (OD-2)`,
      });
      continue;
    }
    if (!(siblingKey in registry.modules)) {
      out.push({
        slug, check: "compose_unknown_sibling", severity: "error",
        message: `composes_with '${siblingKey}' does not resolve to a registered module slug (have: ${Object.keys(registry.modules).join(", ")})`,
      });
      continue;
    }
    // (b/c/d) tag format is enforced at decode; the provider-side declaration +
    // AST schema_hash recompute need the honeycomb substrate (OD-2 defer) → warn.
    out.push({
      slug, check: "tag_hash_unverified", severity: "warn",
      message: `composes_with '${siblingKey}' (${(edge as { tag?: string }).tag ?? "?"}) — sibling resolves; Tag name/version/hash + AST recompute deferred (OD-2)`,
    });
  }
  return out;
}

// ── pure helper: recompute a sealed-schema hash (SDD §3.5 / §3.1 recipe) ─────
export function recomputeSealedHash(schemaJsonText: string): string {
  return sha256Hex(jcsCanonicalize(JSON.parse(schemaJsonText)));
}

// ── pure helper: sealed_schemas (SDD §3.5) ──────────────────────────────────
export function checkSealedSchemas(
  slug: string,
  beacon: BeaconV3,
  resolveSchemaText: (relPath: string) => string | null,
): DoctorFinding[] {
  const out: DoctorFinding[] = [];
  for (const sealed of beacon.sealed_schemas ?? []) {
    if (sealed.hash === ALL_ZEROS_64 || !SHA256_RE.test(sealed.hash)) {
      out.push({
        slug, check: "sealed_schema_hash_drift", severity: "error",
        message: `sealed_schemas '${sealed.path}' has a placeholder/invalid hash (${sealed.hash.slice(0, 12)}…) — never recomputed`,
      });
      continue;
    }
    if (!relPathSafe(sealed.path)) {
      out.push({
        slug, check: "sealed_schema_hash_drift", severity: "error",
        message: `sealed_schemas path '${sealed.path}' is unsafe (absolute or '..')`,
      });
      continue;
    }
    const text = resolveSchemaText(sealed.path);
    if (text == null) {
      out.push({
        slug, check: "sealed_schema_unverified", severity: "warn",
        message: `sealed_schemas '${sealed.path}' not resolvable locally — hash unverified (external building / cluster-side)`,
      });
      continue;
    }
    let recomputed: string;
    try {
      recomputed = recomputeSealedHash(text);
    } catch (err) {
      out.push({
        slug, check: "sealed_schema_hash_drift", severity: "error",
        message: `sealed_schemas '${sealed.path}' is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (recomputed !== sealed.hash) {
      out.push({
        slug, check: "sealed_schema_hash_drift", severity: "error",
        message: `sealed_schemas '${sealed.path}' hash drift: declared ${sealed.hash.slice(0, 12)}… ≠ recomputed ${recomputed.slice(0, 12)}…`,
      });
    } else {
      out.push({
        slug, check: "sealed_schema_ok", severity: "ok",
        message: `sealed_schemas '${sealed.path}' hash verified (sha256+JCS)`,
      });
    }
  }
  return out;
}

// ── impure resolver: events SCHEMA_VERSION for a pin SHA (G-4: no events import) ──
// NB (FAGAN composer B3): the cell's `cluster.eventsPin` points at THIS repo
// (`0xHoneyJar/loa-freeside`, subdir packages/events) — the pin sha is a
// loa-freeside commit, NOT a commit in the cell's own tree. So it is correctly
// resolved against `repoRoot` (the loa-freeside checkout doctor runs in), never
// the cell clone. A shallow loa-freeside checkout that lacks the pinned events
// commit → null → FL-HC1 `runtime_pin_unresolved` warn (documented, SDD R-5).
function makeResolvePinSchemaVersion(repoRoot: string): (sha: string) => string | null {
  return (sha: string): string | null => {
    try {
      const src = execFileSync(
        "git",
        ["show", `${sha}:packages/events/src/envelope.ts`],
        { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
      );
      const m = src.match(/SCHEMA_VERSION\s*=\s*["']([^"']+)["']/);
      return m ? m[1] : null;
    } catch {
      return null; // shallow clone / unknown sha → FL-HC1 warn at the validator
    }
  };
}

// ── per-cell resolution (sprint-400 step 3) ─────────────────────────────────
// Cells are cloned as `<cellsDir>/cell-<slug>/` (cluster-compliance convention).
// Both shipped cells declare their beacon at packages/protocol/beacon.yaml.
const CELL_BEACON_REL = "packages/protocol/beacon.yaml";
/** Receipt path within a cell — repo-relative, git's forward slashes. */
const CELL_RECEIPT_REL = "app/.well-known/acvp-proof-receipt.json";
/** Bound git over an untrusted clone — a pathological repo must not HANG the
 *  single-threaded audit (FAGAN composer: the try/catch catches throws, not hangs). */
const CELL_GIT_TIMEOUT_MS = 15_000;

/**
 * Resolve a cell clone to its realpath via `safeResolve` (which does realpath +
 * cellsDir-containment, so a symlinked `cell-<slug>` cannot escape the cells
 * dir), or null when the clone is absent / escapes containment (→ the caller
 * surfaces it as unreachable; doctor never substitutes a fixture cluster-side).
 */
function resolveCellRoot(cellsDir: string, slug: string): string | null {
  return safeResolve(cellsDir, `cell-${slug}`);
}

/** Soft read: fn()'s value, or `fallback` if it throws — keeps the "never throw
 *  into the audit loop" contract in one place (FAGAN composer cleanup). SCOPE
 *  (BR-3 bridgebuilder): use ONLY for I/O + parse over UNTRUSTED bytes (git /
 *  JSON from a cell clone) — the broad catch deliberately also swallows
 *  programmer errors (TypeError &c.), so never wrap general application logic. */
function softRead<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// Read-only git over an UNTRUSTED cell clone, hardened + time-bounded:
//   -c core.fsmonitor=false → ignore the clone's local fsmonitor hook (FAGAN opus)
//   GIT_LITERAL_PATHSPECS=1 → a crafted path is never read as a pathspec glob
//   timeout                 → a pathological commit graph can't hang the audit (FAGAN)
// Returns stdout on exit 0, or null on ANY failure (non-zero exit, timeout, spawn).
function cellGit(cellRoot: string, args: ReadonlyArray<string>): string | null {
  try {
    return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
      cwd: cellRoot,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
      encoding: "utf-8",
      timeout: CELL_GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** The clone's committed HEAD (full 40-hex) or null. ALL cell evidence (beacon,
 *  receipt, eventsPin, sealed schemas, freshness diff) is read AT this commit, so
 *  a working-tree mutation cannot influence the verdict (FAGAN opus: committed-only). */
function resolveCellHead(cellRoot: string): string | null {
  const head = (cellGit(cellRoot, ["rev-parse", "HEAD"]) ?? "").trim();
  return /^[0-9a-fA-F]{40}$/.test(head) ? head : null;
}

/** A repo-relative path's content AT the audited commit (committed evidence). */
function cellShow(cellRoot: string, head: string, rel: string): string | null {
  return cellGit(cellRoot, ["show", `${head}:${rel}`]);
}

/** Per-cell ACVP inputs for validateAcvpBindings (sprint-400 step 3). */
type CellAcvpInputs = {
  eventsPin: { package: string; sha: string } | null;
  proofReceipts: ReadonlyArray<AcvpProofReceipt> | null;
  buildingHeadSha: string | null;
  checkReceiptFreshness?: (receipt: AcvpProofReceipt) => "fresh" | "stale" | "unknown";
};

/** The safe null posture: no per-cell evidence → every binding un-backed
 *  (default-FAIL) or aspirational-allowlisted (extracted — FAGAN composer). */
const NULL_CELL_INPUTS: CellAcvpInputs = {
  eventsPin: null,
  proofReceipts: null,
  buildingHeadSha: null,
};

/**
 * Shape-guard a proof receipt parsed from an UNTRUSTED cell clone (FAGAN opus):
 * every required field MUST be a string before it may reach validateAcvpBindings
 * (which formats/compares them) — a malformed element must never throw mid-audit
 * or mis-bind on a wrong-typed field. `pipeline_id` is optional.
 */
function isProofReceipt(x: unknown): x is AcvpProofReceipt {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.slug === "string" &&
    typeof r.invariant_id === "string" &&
    typeof r.proof_artifact === "string" &&
    typeof r.test_runner === "string" &&
    typeof r.passed_at === "string" &&
    typeof r.commit_sha === "string"
  );
}

/**
 * Read a cell clone's ACVP inputs for validateAcvpBindings, ALL from the AUDITED
 * COMMITTED HEAD `head` (never the working tree — FAGAN gpt/opus: an uncommitted
 * OR working-tree-mutated receipt/eventsPin must not be able to fabricate `bound`;
 * the beacon + sealed schemas are read committed-only at the call site too): the
 * events pin (committed package.json `cluster.eventsPin`), the per-invariant proof
 * receipts (committed receipt ARRAY, each element shape-validated at this trust
 * boundary — FAGAN opus), and a git freshness resolver. Freshness (FL-B0, FAGAN
 * opus): "fresh" iff NOTHING changed between the receipt commit and `head` except
 * the receipt file itself — checking only the proof FILE is fail-open (the code
 * under test can change while the test stays byte-identical). Fails soft to the
 * un-backed default (null / "unknown").
 *
 * KNOWN LIMITATION (FAGAN composer B1, tracked follow-up): the receipt is an
 * UNSIGNED self-assertion whose commit_sha the cell controls — a first-party cell
 * CAN commit a forged receipt (clean tree + a receipt claiming bound). This check
 * binds the verdict to the COMMITTED state (forgery requires an attributable,
 * reviewable commit), which fits the first-party drift-detection threat model;
 * full non-repudiation requires SIGNED receipts (Ed25519, as the ACVP runtime
 * envelope already does). Out of scope for this verb.
 */
function resolveCellAcvpInputs(cellRoot: string, head: string): CellAcvpInputs {
  // eventsPin ← committed package.json cluster.eventsPin (sovereign pin)
  const eventsPin = softRead<{ package: string; sha: string } | null>(() => {
    const txt = cellShow(cellRoot, head, "package.json");
    if (txt == null) return null;
    const pkg = JSON.parse(txt) as { cluster?: { eventsPin?: { package?: unknown; sha?: unknown } } };
    const ep = pkg.cluster?.eventsPin;
    return ep && typeof ep.package === "string" && typeof ep.sha === "string"
      ? { package: ep.package, sha: ep.sha }
      : null;
  }, null);

  // proofReceipts ← committed receipt ARRAY (FL-HC0); each element shape-validated
  const proofReceipts = softRead<ReadonlyArray<AcvpProofReceipt> | null>(() => {
    const txt = cellShow(cellRoot, head, CELL_RECEIPT_REL);
    if (txt == null) return null;
    const parsed = JSON.parse(txt);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(isProofReceipt);
    return valid.length > 0 ? valid : null;
  }, null);

  // freshness ← did the cell drift since the receipt? "fresh" iff the ONLY change
  // between the receipt commit and the audited `head` is the receipt file itself
  // (the off-by-one that publishing it adds); ANY other changed path → "stale".
  // Full-40-hex sha; receipt commit must be reachable from head (ancestor/==).
  const checkReceiptFreshness = (receipt: AcvpProofReceipt): "fresh" | "stale" | "unknown" => {
    const sha = receipt.commit_sha;
    if (!/^[0-9a-fA-F]{40}$/.test(sha)) return "unknown";
    // merge-base --is-ancestor signals via exit code: cellGit → "" on exit 0
    // (ancestor), null on exit 1 (not) / error. shallow clone / force-push → null.
    if (cellGit(cellRoot, ["merge-base", "--is-ancestor", sha, head]) == null) return "unknown";
    const names = cellGit(cellRoot, [
      "diff", "--name-only", "--no-ext-diff", "--no-textconv", "--no-renames", sha, head,
    ]);
    if (names == null) return "unknown";
    const drifted = names
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== CELL_RECEIPT_REL);
    return drifted.length === 0 ? "fresh" : "stale";
  };

  return { eventsPin, proofReceipts, buildingHeadSha: head, checkReceiptFreshness };
}

/**
 * Read the flat aspirational allowlist (slug/id/expires per entry) WITHOUT a
 * yaml dep — keeps freeside-cli dependency-light (G-4 spirit). The file is a
 * fixed, operator-controlled shape (T6): an `allowlist:` key then `- slug:`
 * list items. Only slug/id/expires are load-bearing for validateAcvpBindings;
 * `reason` is documentation and is not parsed. Tested in tests/allowlist.test.ts.
 */
export function readAllowlist(allowlistPath: string): ReadonlyArray<AcvpAllowlistEntry> {
  try {
    if (!existsSync(allowlistPath)) return [];
    const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
    const entries: AcvpAllowlistEntry[] = [];
    let cur: { slug?: string; id?: string; expires?: string } | null = null;
    let inList = false;
    const flush = () => {
      if (cur && cur.slug && cur.id && cur.expires) {
        entries.push({ slug: cur.slug, id: cur.id, expires: cur.expires });
      }
    };
    for (const raw of readFileSync(allowlistPath, "utf-8").split(/\r?\n/)) {
      if (/^\s*#/.test(raw) || raw.trim() === "") continue;
      if (!inList) {
        if (/^\s*allowlist\s*:/.test(raw)) inList = true;
        continue;
      }
      const dashSlug = raw.match(/^\s*-\s*slug\s*:\s*(.+)$/);
      if (dashSlug) { flush(); cur = { slug: unquote(dashSlug[1]) }; continue; }
      if (/^\s*-\s*$/.test(raw)) { flush(); cur = {}; continue; } // bare-dash block style
      const kv = raw.match(/^\s+(slug|id|expires)\s*:\s*(.+)$/);
      if (kv && cur) cur[kv[1] as "slug" | "id" | "expires"] = unquote(kv[2]);
    }
    flush();
    return entries;
  } catch {
    return [];
  }
}

export const doctor = async (opts: DoctorOptions = {}): Promise<DoctorReport> => {
  const now = opts.now ?? new Date();
  const registryPath = opts.registryPath;
  const registry = registryPath ? loadRegistry(registryPath) : loadRegistry();
  const registryRoot = registryPath ? dirname(realpathSync(registryPath)) : undefined;
  const repoRoot = process.cwd();
  const allowlistPath = opts.allowlistPath ?? join(repoRoot, ".freeside", "acvp-aspirational-allowlist.yaml");
  const allowlist = readAllowlist(allowlistPath);
  const resolvePinSchemaVersion = makeResolvePinSchemaVersion(repoRoot);

  const findings: DoctorFinding[] = [];
  const push = (f: DoctorFinding) => findings.push(f);

  for (const [slug, entry] of Object.entries(registry.modules)) {
    const cellRoot = opts.cellsDir ? resolveCellRoot(opts.cellsDir, slug) : null;
    // committed HEAD of the cell clone — ALL cell evidence (beacon, receipt,
    // eventsPin, sealed schemas, freshness diff) is read AT this sha, so a
    // working-tree mutation cannot influence the verdict (FAGAN opus, committed-only).
    const cellHead = cellRoot ? resolveCellHead(cellRoot) : null;

    // cellsDir requested but THIS cell's clone is absent/unresolvable: refuse to
    // fall through to the in-repo fixture path (FAGAN composer). Cluster-side
    // evidence MUST be the cell's own committed state — a substituted fixture
    // would produce findings that look like a cell audit but are not. Surface it
    // as unreachable (the per-cell clone step must run first), never silent.
    if (opts.cellsDir && !cellRoot) {
      push({
        slug, check: "beacon_unreachable", severity: "warn",
        message: `--cells-dir set but no clone at cell-${slug}/ — cell evidence unavailable; refusing fixture substitution (run the per-cell clone step first)`,
      });
      continue;
    }

    // 1. Resolve beacon. cellsDir (a per-cell clone) is the authoritative
    // cluster-side source and takes precedence (sprint-400 step 3) — the beacon is
    // read from the COMMITTED HEAD (git show), NOT the working tree, so a mutated
    // working-tree beacon.yaml cannot add/relax invariants under doctor (FAGAN opus).
    // Else FAGAN iter-2 (gpt): --remote must NOT silently fall back to a fixture — a
    // caller asking for live remote evidence gets beacon_unreachable (SC-6), never
    // fixture-substituted data; no fixture → deferred.
    let resolved: ReturnType<typeof loadBeacon>;
    let moduleRoot: string; // root for sealed-schema / per-cell reads
    if (cellRoot) {
      moduleRoot = cellRoot;
      if (cellHead == null) {
        push({
          slug, check: "beacon_invalid", severity: "error",
          message: `cell clone ${slug}: cannot resolve a committed HEAD (not a git checkout / shallow) — cannot audit committed state`,
        });
        continue;
      }
      const beaconText = cellShow(cellRoot, cellHead, CELL_BEACON_REL);
      if (beaconText == null) {
        push({
          slug, check: "beacon_deferred", severity: "warn",
          message: `cell clone ${slug}: no committed ${CELL_BEACON_REL} at HEAD — beacon audit deferred`,
        });
        continue;
      }
      resolved = loadBeaconFromText(beaconText);
      if (resolved.kind === "error") {
        push({
          slug, check: "beacon_invalid", severity: "error",
          message: `cell clone ${slug} (${CELL_BEACON_REL}@HEAD): ${resolved.error}`,
        });
        continue;
      }
    } else if (opts.remote) {
      push({
        slug, check: "beacon_unreachable", severity: "warn",
        message: `--remote fetch of ${entry.beacon_url} not implemented this build (SC-6); fixture substitution refused — omit --remote to audit the in-repo fixture`,
      });
      continue;
    } else if (!entry.beacon_fixture) {
      push({
        slug, check: "beacon_deferred", severity: "warn",
        message: `no beacon_fixture for '${slug}' — beacon audit deferred (add beacon_fixture, --cells-dir, or --remote when fetch lands)`,
      });
      continue;
    } else {
      if (entry.visibility === "internal") {
        push({
          slug, check: "beacon_auth_required", severity: "warn",
          message: `'${slug}' is internal — auth-gated fetch not implemented (SC-2); fixture audited if present`,
        });
      }
      moduleRoot = registryRoot ?? repoRoot;
      resolved = loadBeacon(entry, registryRoot);
      if (resolved.kind === "error") {
        push({ slug, check: "beacon_invalid", severity: "error", message: resolved.error });
        continue;
      }
    }
    if (resolved.kind === "legacy") {
      const nextReview = (resolved.beacon as { cycle_state?: { next_review?: string } }).cycle_state?.next_review;
      push({
        slug, check: "beacon_legacy_v2", severity: "warn",
        message: `BeaconV2 detected — migrate to V3${nextReview ? ` by ${nextReview}` : ""} (ADR-007 A.4)`,
      });
      continue;
    }

    // 2. V3 validated by loadBeacon's decode; re-affirm via validateBeaconV3 (defensive)
    const v = validateBeaconV3(resolved.beacon);
    if (!v.ok) {
      push({ slug, check: "beacon_invalid", severity: "error", message: v.error });
      continue;
    }
    const beacon = v.beacon;
    push({ slug, check: "beacon_valid", severity: "ok", message: "beacon validates against BeaconV3" });

    // 3-5. cycle_state, composes_with, sealed_schemas (pure helpers).
    // Skipped under --acvp (acvpOnly) so the report-only ACVP CI surfaces
    // binding findings only, not unrelated cycle/compose/sealed errors (FAGAN).
    if (!opts.acvpOnly) {
      for (const f of checkCycleState(slug, beacon, now)) push(f);
      for (const f of checkComposesWith(slug, beacon, registry)) push(f);
      // sealed-schema files: from the COMMITTED HEAD in cellsDir mode (committed-
      // only, FAGAN opus — git rejects out-of-tree `..` paths), else the local
      // working tree (in-repo fixture / same-repo self-audit).
      const resolveSchemaText = (relPath: string): string | null => {
        if (cellRoot && cellHead) return cellShow(cellRoot, cellHead, relPath);
        const p = safeResolve(moduleRoot, relPath);
        return p ? readFileSync(p, "utf-8") : null;
      };
      for (const f of checkSealedSchemas(slug, beacon, resolveSchemaText)) push(f);
    }

    // 6. ACVP binding sub-check (folds AcvpBindingFinding → DoctorFinding).
    // Per-cell inputs come from the cell clone when --cells-dir resolved one
    // (sprint-400 step 3). Otherwise they stay null — the safe cluster-side
    // posture FAGAN iter-2 established: reading cluster.eventsPin / proof
    // receipts from the shared registry root would (a) read the REGISTRY
    // package's own package.json as a building's and (b) let one shared receipt
    // vouch for every slug. Null → every binding un-backed (default-FAIL) or
    // aspirational-allowlisted. A resolved cell supplies a real checkout, so the
    // receipt is consumed + git-freshness-checked (a committed receipt → bound).
    try {
      const cellInputs = cellRoot && cellHead ? resolveCellAcvpInputs(cellRoot, cellHead) : NULL_CELL_INPUTS;
      const acvp = validateAcvpBindings({
        slug, beacon, moduleRoot,
        // Cluster-side (cellsDir): evidence is the COMMITTED, freshness-checked
        // receipt — NOT mere file-presence in the clone working tree. Letting a
        // present-but-unattested proof file vouch would re-introduce the weak
        // file-presence signal (the α path the operator rejected; FAGAN opus's
        // fail-open concern). So fileExists is false here: a cell is bound only
        // via a fresh receipt. The local-file path stays for same-repo / Tier-A
        // self-audit (no cellsDir), where the building IS the source.
        fileExists: cellRoot ? () => false : (rel) => safeResolve(moduleRoot, rel) !== null,
        eventsPin: cellInputs.eventsPin,
        resolvePinSchemaVersion,
        proofReceipts: cellInputs.proofReceipts,
        buildingHeadSha: cellInputs.buildingHeadSha,
        checkReceiptFreshness: cellInputs.checkReceiptFreshness,
        aspirationalAllowlist: allowlist,
        now,
      });
      for (const af of acvp.findings) {
        push({
          slug, check: af.check as DoctorCheck, severity: af.severity,
          message: `[acvp:${af.invariant_id}] ${af.message}`,
        });
      }
    } catch (err) {
      // defense-in-depth (FAGAN opus): a single cell's unexpected throw must
      // never abort the whole audit (DoS) — surface it as that slug's error.
      push({
        slug, check: "beacon_invalid", severity: "error",
        message: `ACVP sub-check aborted for ${slug}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    checked_at: now.toISOString(),
    modules_checked: Object.keys(registry.modules).length,
    findings,
    summary: {
      ok: findings.filter((f) => f.severity === "ok").length,
      warn: findings.filter((f) => f.severity === "warn").length,
      error: findings.filter((f) => f.severity === "error").length,
    },
  };
};
