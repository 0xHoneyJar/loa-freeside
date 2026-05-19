/**
 * `loa freeside doctor` — audit all freeside-* modules against BeaconV3 schema.
 *
 * For each registered module:
 *   1. Fetch its beacon_url
 *   2. Validate against BeaconV3 (or V2 legacy with warning)
 *   3. Resolve composes_with Tag references (TagName@version+hash)
 *   4. Check cycle_state.next_review against current date
 *   5. Emit compliance report
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6 + Appendix A.3
 * STUB: full network + validation pipeline deferred to follow-up cycle.
 */

import { loadRegistry } from "@freeside/freeside-registry";

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

export const doctor = (): DoctorReport => {
  const registry = loadRegistry();
  const findings: DoctorFinding[] = [];

  for (const [slug, entry] of Object.entries(registry.modules)) {
    // STUB: emit a "deferred" finding per module so the verb produces
    // visible output. Real network fetch + V3 validation lands in follow-up.
    findings.push({
      slug,
      check: "beacon_fetch",
      severity: "warn",
      message: `Beacon validation deferred (would fetch ${entry.beacon_url}); see ADR-007 §Implementation step 7 for follow-up cycle that wires this in.`,
    });
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
