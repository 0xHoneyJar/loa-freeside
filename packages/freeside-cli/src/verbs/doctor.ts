/**
 * `loa freeside doctor` — audit registered buildings against BeaconV3.
 *
 * For each registry entry:
 *   REGISTRY-LEVEL (no network):
 *     1. slug is a `*-api` building identity (ADR-008 §D-11)
 *     2. rename: done ⇒ git_url basename === slug (the rename actually landed)
 *   BEACON-LEVEL (network — best-effort, injectable for tests):
 *     3. fetch beacon_url; unreachable ⇒ warn (beacon not yet deployed)
 *     4. validate against BeaconV3 schema
 *     5. beacon.slug === registry slug
 *     6. cycle_state: next_review ≤ since + 180d, and not already in the past
 *
 * NOT YET DONE (honest scope, see registry.yaml + beacon-v3.ts notes):
 *   composes_with tag hashes are FORMAT-checked by the schema but NOT
 *   recomputed against the sibling's port schema (that needs cross-building
 *   schema resolution — a future doctor enhancement; flatline SKP-004).
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6 + Appendix A.3
 *            decisions/008-freeside-as-factory.md §D-11
 */

import { loadRegistry, type Registry } from "@freeside/freeside-registry";
import { validateBeaconV3 } from "@freeside/beacon-schema";

export type Severity = "ok" | "warn" | "error";

export interface DoctorFinding {
  readonly slug: string;
  readonly check: string;
  readonly severity: Severity;
  readonly message: string;
}

export interface DoctorReport {
  readonly checked_at: string;
  readonly modules_checked: number;
  readonly findings: ReadonlyArray<DoctorFinding>;
  readonly summary: { ok: number; warn: number; error: number };
}

/** Returns the parsed beacon JSON, or null when unreachable / non-OK / invalid JSON. */
export type BeaconFetcher = (url: string) => Promise<unknown | null>;

export interface DoctorDeps {
  /** Override the registry (tests). Defaults to loadRegistry(). */
  readonly registry?: Registry;
  /** Override beacon fetching (tests). Defaults to an HTTP fetch with timeout. */
  readonly fetchBeacon?: BeaconFetcher;
  /** Override "now" (tests). Defaults to new Date(). */
  readonly now?: Date;
  /** Per-fetch timeout in ms (default 5000). */
  readonly timeoutMs?: number;
}

const SLUG_API_RE = /^[a-z][a-z0-9-]*-api$/;
const MAX_REVIEW_DAYS = 180;
const DAY_MS = 86_400_000;

export const makeHttpFetcher =
  (timeoutMs: number): BeaconFetcher =>
  async (url) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  };

const gitUrlBasename = (gitUrl: string): string =>
  gitUrl.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean).pop() ?? "";

export const doctor = async (deps: DoctorDeps = {}): Promise<DoctorReport> => {
  const registry = deps.registry ?? loadRegistry();
  const now = deps.now ?? new Date();
  const fetchBeacon = deps.fetchBeacon ?? makeHttpFetcher(deps.timeoutMs ?? 5000);

  const findings: DoctorFinding[] = [];
  const entries = Object.entries(registry.modules);

  for (const [slug, entry] of entries) {
    const before = findings.length;

    // ── registry-level (no network) ──────────────────────────────────────
    if (!SLUG_API_RE.test(slug)) {
      findings.push({
        slug,
        check: "slug_convention",
        severity: "error",
        message: `registry slug '${slug}' is not a *-api building identity (ADR-008 §D-11)`,
      });
    }
    if (entry.rename === "done") {
      const base = gitUrlBasename(entry.git_url);
      if (base !== slug) {
        findings.push({
          slug,
          check: "rename_reconcile",
          severity: "warn",
          message: `rename: done but git_url basename '${base}' != slug '${slug}' — repo rename may not have landed`,
        });
      }
    }

    // ── beacon-level (network, best-effort) ──────────────────────────────
    const raw = await fetchBeacon(entry.beacon_url);
    if (raw === null || raw === undefined) {
      findings.push({
        slug,
        check: "beacon_fetch",
        severity: "warn",
        message: `beacon unreachable at ${entry.beacon_url} (not deployed yet?)`,
      });
      continue;
    }

    const result = validateBeaconV3(raw);
    if (!result.ok || !result.beacon) {
      findings.push({
        slug,
        check: "beacon_validate",
        severity: "error",
        message: `beacon at ${entry.beacon_url} failed BeaconV3 validation: ${
          result.error ?? "unknown error"
        }`,
      });
      continue;
    }

    const beacon = result.beacon;
    if (beacon.slug !== slug) {
      findings.push({
        slug,
        check: "slug_match",
        severity: "error",
        message: `beacon slug '${beacon.slug}' != registry slug '${slug}'`,
      });
    }

    const since = Date.parse(beacon.cycle_state.since);
    const review = Date.parse(beacon.cycle_state.next_review);
    if (Number.isFinite(since) && Number.isFinite(review)) {
      const days = (review - since) / DAY_MS;
      if (days > MAX_REVIEW_DAYS) {
        findings.push({
          slug,
          check: "review_window",
          severity: "warn",
          message: `cycle_state.next_review is ${Math.round(days)}d after since (max ${MAX_REVIEW_DAYS})`,
        });
      }
      if (review < now.getTime()) {
        findings.push({
          slug,
          check: "review_overdue",
          severity: "warn",
          message: `cycle_state.next_review ${beacon.cycle_state.next_review} is in the past — re-confirm cycle_state`,
        });
      }
    }

    if (findings.length === before) {
      findings.push({
        slug,
        check: "beacon",
        severity: "ok",
        message: `beacon valid (${beacon.cycle_state.status})`,
      });
    }
  }

  return {
    checked_at: now.toISOString(),
    modules_checked: entries.length,
    findings,
    summary: {
      ok: findings.filter((f) => f.severity === "ok").length,
      warn: findings.filter((f) => f.severity === "warn").length,
      error: findings.filter((f) => f.severity === "error").length,
    },
  };
};
