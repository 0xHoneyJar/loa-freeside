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

function readJsonIfPresent<T>(p: string): T | null {
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as T) : null;
  } catch {
    return null;
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
    // 1. Resolve beacon (fixture-first; --remote out of scope this build, SC-6)
    if (!entry.beacon_fixture) {
      push({
        slug,
        check: opts.remote ? "beacon_unreachable" : "beacon_deferred",
        severity: "warn",
        message: opts.remote
          ? `--remote fetch of ${entry.beacon_url} not implemented this build (SC-6); add a beacon_fixture to audit`
          : `no beacon_fixture for '${slug}' — beacon audit deferred (add beacon_fixture, or --remote when fetch lands)`,
      });
      continue;
    }
    if (entry.visibility === "internal") {
      push({
        slug, check: "beacon_auth_required", severity: "warn",
        message: `'${slug}' is internal — auth-gated fetch not implemented (SC-2); fixture audited if present`,
      });
    }
    const resolved = loadBeacon(entry, registryRoot);
    if (resolved.kind === "error") {
      push({ slug, check: "beacon_invalid", severity: "error", message: resolved.error });
      continue;
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
      const resolveSchemaText = (relPath: string): string | null => {
        if (!registryRoot) return null;
        const p = safeResolve(registryRoot, relPath);
        return p ? readFileSync(p, "utf-8") : null;
      };
      for (const f of checkSealedSchemas(slug, beacon, resolveSchemaText)) push(f);
    }

    // 6. ACVP binding sub-check (folds AcvpBindingFinding → DoctorFinding)
    const moduleRoot = registryRoot ?? repoRoot;
    const eventsPin = readJsonIfPresent<{ cluster?: { eventsPin?: { package: string; sha: string } } }>(
      join(moduleRoot, "package.json"),
    )?.cluster?.eventsPin ?? null;
    const proofReceipts = readJsonIfPresent<AcvpProofReceipt[]>(
      join(moduleRoot, "app", ".well-known", "acvp-proof-receipt.json"),
    );
    const acvp = validateAcvpBindings({
      slug, beacon, moduleRoot,
      fileExists: (rel) => safeResolve(moduleRoot, rel) !== null,
      eventsPin,
      resolvePinSchemaVersion,
      proofReceipts,
      buildingHeadSha: null, // unknown cluster-side this build (SC)
      aspirationalAllowlist: allowlist,
      now,
    });
    for (const af of acvp.findings) {
      push({
        slug, check: af.check as DoctorCheck, severity: af.severity,
        message: `[acvp:${af.invariant_id}] ${af.message}`,
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
