/**
 * `loa freeside doctor` — audit registered freeside-* buildings (cycle-049 FR-4).
 *
 * Per registry module (SDD §4.2 severity matrix):
 *   beacon_decode         loadBeacon → v3 = ok · legacy = warn · error = …
 *   belt_tag_resolve      each `consumes.from` sibling is in the registry
 *   cycle_state_freshness `next_review` vs today
 *
 * `bin/freeside-cli.ts` maps `summary.error > 0` → exit 1. The fixture set
 * (freeside-score, V3, fresh `cycle_state`) is all-ok → exit 0; remote / V2
 * modules surface as `warn` and never fail the gate.
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6 + Appendix A.3
 */

import {
  loadRegistry,
  loadBeacon,
  type Registry,
} from "@freeside/freeside-registry";

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

export interface DoctorOptions {
  /** Override the registry (testing). Default: `loadRegistry()`. */
  readonly registry?: Registry;
}

/** `next_review` within this many days of today is a `warn`. */
const WARN_WINDOW_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export const doctor = (opts: DoctorOptions = {}): DoctorReport => {
  const registry = opts.registry ?? loadRegistry();
  const findings: DoctorFinding[] = [];
  const now = Date.now();

  for (const [slug, entry] of Object.entries(registry.modules)) {
    const result = loadBeacon(entry);

    // ── beacon_decode ──────────────────────────────────────────────────
    if (result.kind === "v3") {
      findings.push({
        slug,
        check: "beacon_decode",
        severity: "ok",
        message: "BeaconV3 decodes clean",
      });
    } else if (result.kind === "legacy") {
      findings.push({
        slug,
        check: "beacon_decode",
        severity: "warn",
        message: `${slug}: BeaconV2 detected — migrate to V3`,
      });
    } else {
      // loadBeacon error. Distinguish a malformed in-repo fixture (a beacon
      // that SHOULD decode → error) from a remote beacon_url that is simply
      // not fetched this cycle (out of scope → warn).
      const isFixture = entry.beacon_fixture !== undefined;
      findings.push({
        slug,
        check: "beacon_decode",
        severity: isFixture ? "error" : "warn",
        message: isFixture
          ? `${slug}: beacon_fixture failed to decode — ${result.error}`
          : `${slug}: remote beacon not fetched this cycle — ${result.error}`,
      });
    }

    if (result.kind !== "v3") continue;
    const beacon = result.beacon;

    // ── belt_tag_resolve ── each consumes.from sibling must be registered ─
    for (const belt of beacon.consumes) {
      const siblingKnown = registry.modules[belt.from] !== undefined;
      findings.push({
        slug,
        check: "belt_tag_resolve",
        severity: siblingKnown ? "ok" : "warn",
        message: siblingKnown
          ? `consumes ${belt.from}/${belt.belt} — sibling registered (tag ${belt.tag})`
          : `consumes ${belt.from}/${belt.belt} — sibling '${belt.from}' is not in the registry`,
      });
    }

    // ── cycle_state_freshness ──────────────────────────────────────────
    const nextReview = Date.parse(beacon.cycle_state.next_review);
    let severity: Severity;
    let message: string;
    if (Number.isNaN(nextReview)) {
      severity = "error";
      message = `cycle_state.next_review unparseable: ${beacon.cycle_state.next_review}`;
    } else {
      const daysLeft = (nextReview - now) / MS_PER_DAY;
      if (daysLeft < 0) {
        severity = "error";
        message = `cycle_state.next_review ${beacon.cycle_state.next_review} is in the past`;
      } else if (daysLeft <= WARN_WINDOW_DAYS) {
        severity = "warn";
        message = `cycle_state.next_review ${beacon.cycle_state.next_review} is within ${WARN_WINDOW_DAYS} days`;
      } else {
        severity = "ok";
        message = `cycle_state.next_review ${beacon.cycle_state.next_review} is in the future`;
      }
    }
    findings.push({ slug, check: "cycle_state_freshness", severity, message });
  }

  return {
    checked_at: new Date().toISOString(),
    modules_checked: Object.keys(registry.modules).length,
    findings,
    summary: {
      ok: findings.filter((f) => f.severity === "ok").length,
      warn: findings.filter((f) => f.severity === "warn").length,
      error: findings.filter((f) => f.severity === "error").length,
    },
  };
};
