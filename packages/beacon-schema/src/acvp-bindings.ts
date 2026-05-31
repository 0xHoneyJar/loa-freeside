/**
 * ACVP-binding validator — binds each declared `acvp_invariant` to (a) a real
 * passing proof and (b) the `acvp-l1-v2` runtime envelope. PURE core: takes
 * already-read inputs + injected resolvers (no fs/git here). Surfaced through
 * freeside-cli `doctor` (SDD cycle doctor-acvp-network-plane §4).
 *
 * G-4 dependency-light: does NOT import `@freeside/events`. The acvp-l1-v2
 * SCHEMA_VERSION is a *contract value* (string constant); the pin's actual
 * SCHEMA_VERSION is resolved via an injected resolver.
 *
 * DEFAULT = FAIL: a dangling proof or a runtime-vocabulary mismatch is `error`
 * unless the invariant is `status: aspirational` AND dated-allowlisted (then
 * `warn` with a countdown until expiry, `error` after). Silent aspiration is
 * the disease this validator exists to cure.
 *
 * Flatline-hardened (SDD §2.1): per-invariant receipts (FL-HC0), null-resolver
 * severity (FL-HC1), receipt-borne external existence (FL-HC6), relaxed
 * freshness with no false-downgrade (FL-B0), explicit `now` injection (FL-D0).
 */
import type { BeaconV3 } from "./beacon-v3.js";

/** The acvp-l1-v2 envelope schema version — a CONTRACT VALUE, not a runtime import (G-4). */
export const ACVP_L1_SCHEMA_VERSION = "acvp-l1-v2" as const;

type AcvpInvariantT = BeaconV3["acvp_invariants"][number];

export type AcvpBindingType = "proof" | "runtime";
export type AcvpSeverity = "ok" | "warn" | "error";

export interface AcvpProofReceipt {
  readonly slug: string;
  readonly invariant_id: string;
  readonly proof_artifact: string;
  readonly test_runner: string;
  readonly passed_at: string;
  readonly commit_sha: string;
  /** optional CI run correlator (FL-B0 freshness fallback) */
  readonly pipeline_id?: string;
}

export interface AcvpAllowlistEntry {
  readonly slug: string;
  readonly id: string;
  /** ISO date YYYY-MM-DD — valid through this day inclusive */
  readonly expires: string;
}

export interface AcvpBindingFinding {
  readonly slug: string;
  readonly invariant_id: string;
  readonly binding: AcvpBindingType;
  readonly severity: AcvpSeverity;
  /** stable check id, e.g. "acvp_proof:event_completeness" (FL-HC5) */
  readonly check: string;
  readonly message: string;
  readonly aspirational_until?: string;
}

export interface AcvpBindingReport {
  readonly slug: string;
  readonly checked_at: string;
  readonly findings: ReadonlyArray<AcvpBindingFinding>;
  readonly summary: { readonly ok: number; readonly warn: number; readonly error: number };
  readonly contract_status: "bound" | "aspirational" | "broken";
}

export interface ValidateAcvpBindingsInput {
  /** registry slug under audit (the report + allowlist key on this) */
  readonly slug: string;
  /** already decoded via validateBeaconV3 */
  readonly beacon: BeaconV3;
  readonly moduleRoot: string;
  /** injected — true if the proof_artifact resolves locally (Tier-A / same-repo) */
  readonly fileExists: (rel: string) => boolean;
  readonly eventsPin?: { readonly package: string; readonly sha: string } | null;
  /** injected — resolve a pin SHA to its events SCHEMA_VERSION (no events import) */
  readonly resolvePinSchemaVersion: (sha: string) => string | null;
  /** per-invariant receipts (FL-HC0); matched by invariant_id + proof_artifact */
  readonly proofReceipts?: ReadonlyArray<AcvpProofReceipt> | null;
  /** null = unknown → freshness unconfirmed, do NOT downgrade (FL-B0) */
  readonly buildingHeadSha?: string | null;
  /**
   * injected (FL-B0 restored, sprint-400 step 3): for a MATCHED receipt whose
   * commit_sha is not exactly buildingHeadSha, decide whether the receipt still
   * attests the code at the audited HEAD:
   *   "fresh"   = the attested state still holds at HEAD          → ok (bound)
   *   "stale"   = the cell advanced/changed since the receipt     → warn (aspirational)
   *   "unknown" = undeterminable (shallow clone / missing history) → fall back to
   *               the strict head-equality guard (never auto-pass)
   * Consulted ONLY when buildingHeadSha is non-null (an audited pin exists). A
   * COMMITTED in-repo receipt advances HEAD past the commit_sha it recorded, so
   * exact-HEAD match alone can never accept one — this resolver is what lets a
   * real receipt resolve to `bound`. Absent the resolver the validator keeps the
   * exact-HEAD behaviour, so all prior call-sites and tests are unchanged. HOW
   * freshness is determined is the caller's concern (the CLI compares the cell
   * tree at the receipt commit vs HEAD); the core only consumes the verdict.
   */
  readonly checkReceiptFreshness?: (receipt: AcvpProofReceipt) => "fresh" | "stale" | "unknown";
  readonly aspirationalAllowlist: ReadonlyArray<AcvpAllowlistEntry>;
  /** injected for deterministic expiry checks (FL-D0); defaults to new Date() */
  readonly now?: Date;
}

// ── static ID → runtime-class obligation (the operator-owned contract, §4.2) ──
type RuntimeObligation = "envelope" | "audit_replay_od" | "skip";

const ALWAYS_ENVELOPE = new Set(["hash_chain", "event_completeness"]);
const CONSTRUCT_LOCAL = new Set(["monotonicity", "idempotency", "state_machine_totality"]);

function runtimeObligation(inv: AcvpInvariantT): RuntimeObligation {
  if (inv.id === "audit_replay") return "audit_replay_od";
  if (ALWAYS_ENVELOPE.has(inv.id)) return "envelope";
  // schema_enforcement: envelope-bound only if explicitly runtime_class:envelope;
  // otherwise self-schema (mediums-style) → proof binding only.
  if (inv.id === "schema_enforcement") {
    return inv.runtime_class === "envelope" ? "envelope" : "skip";
  }
  // construct-local IDs carry no eventsPin obligation unless explicitly envelope.
  if (CONSTRUCT_LOCAL.has(inv.id)) {
    return inv.runtime_class === "envelope" ? "envelope" : "skip";
  }
  return "skip";
}

/** path-component discipline: reject absolute paths + `..` traversal (L6/L7). */
function proofPathSafe(p: string): boolean {
  if (!p) return false;
  if (p.startsWith("/")) return false;
  return !p.split(/[\\/]/).some((seg) => seg === "..");
}

type Raw = { severity: AcvpSeverity; message: string };

// proof binding → raw severity (before the status/aspirational gate)
function rawProofFinding(inv: AcvpInvariantT, input: ValidateAcvpBindingsInput): Raw {
  if (!proofPathSafe(inv.proof_artifact)) {
    return {
      severity: "error",
      message: `proof_artifact '${inv.proof_artifact}' is unsafe (absolute path or '..' traversal)`,
    };
  }
  // Receipt MUST be slug-scoped (FAGAN gpt+opus): invariant ids are a fixed enum
  // and proof_artifact paths follow tests/acvp/<id>.test.ts, so building A and B
  // routinely share both — a receipt is only valid for the building it was issued
  // for, else a cross-slug receipt turns an un-backed (default-FAIL) invariant green.
  const receipt = (input.proofReceipts ?? []).find(
    (r) =>
      r.slug === input.slug &&
      r.invariant_id === inv.id &&
      r.proof_artifact === inv.proof_artifact,
  );
  if (receipt) {
    const head = input.buildingHeadSha;
    // FL-B0: head unknown → fresh-enough, do NOT downgrade
    if (head != null && receipt.commit_sha === head) {
      return {
        severity: "ok",
        message: `proof receipt fresh (commit ${short(receipt.commit_sha)} == building HEAD)`,
      };
    }
    // FL-B0 (restored): consult the injected freshness resolver — but ONLY with
    // an audited HEAD pin (FAGAN composer: a "fresh" verdict under a null head
    // would yield `bound` with no commit binding, re-opening the null-head hole).
    // The resolver's contract lives on ValidateAcvpBindingsInput.checkReceiptFreshness;
    // "unknown" falls through to the strict guard below — only a positive "fresh"
    // under a real pin yields ok.
    if (head != null && input.checkReceiptFreshness) {
      const verdict = input.checkReceiptFreshness(receipt);
      if (verdict === "fresh") {
        return {
          severity: "ok",
          message: `proof receipt commit-bound: '${inv.proof_artifact}' unchanged since receipt commit ${short(receipt.commit_sha)} (${receipt.test_runner})`,
        };
      }
      if (verdict === "stale") {
        return {
          severity: "warn",
          message: `proof receipt STALE: '${inv.proof_artifact}' changed since receipt commit ${short(receipt.commit_sha)} — re-run the proof (promote) or it stays aspirational`,
        };
      }
      // "unknown" → undeterminable; fall through to the FAGAN head guard below.
    }
    // FAGAN iter-2 (opus): a receipt that is NOT commit-bound to current code
    // cannot be reported `ok`/bound — it degrades to `warn` (aspirational). This
    // closes the gap FL-B0's no-downgrade rule left open: buildingHeadSha is null
    // cluster-side, so every receipt would otherwise auto-pass UNVERIFIED — the
    // exact silent aspiration this validator exists to forbid.
    return {
      severity: "warn",
      message:
        head == null
          ? `proof receipt present (${receipt.test_runner}) but freshness UNCONFIRMABLE (building HEAD unknown) — not commit-bound, aspirational`
          : `proof receipt present but NOT commit-bound (receipt ${short(receipt.commit_sha)} != HEAD ${short(head)}) — aspirational`,
    };
  }
  // FL-HC6: cluster-side cannot fileExists an external repo → rely on receipt;
  // local file (Tier-A / same-repo) proves existence, green-ness owned at source.
  if (input.fileExists(inv.proof_artifact)) {
    return {
      severity: "ok",
      message: `proof_artifact resolves locally (green-ness owned at source / Tier-A)`,
    };
  }
  return {
    severity: "error",
    message: `proof_artifact '${inv.proof_artifact}' not found and no proof-receipt — un-backed (default-FAIL)`,
  };
}

// runtime binding → raw severity (before the status/aspirational gate); null = n/a (skip)
function rawRuntimeFinding(inv: AcvpInvariantT, input: ValidateAcvpBindingsInput): Raw | null {
  const ob = runtimeObligation(inv);
  if (ob === "skip") return null; // construct-local / self-schema — proof binding only
  if (ob === "audit_replay_od" && inv.runtime_class === "storage") {
    return {
      severity: "ok",
      message: `audit_replay storage-bound (runtime_class:storage) — no eventsPin required`,
    };
  }
  // envelope obligation (incl. audit_replay without the storage flag)
  const pin = input.eventsPin;
  if (!pin) {
    return {
      severity: "error",
      message: `${inv.id} is envelope-bound but the building declares no cluster.eventsPin`,
    };
  }
  const ver = input.resolvePinSchemaVersion(pin.sha);
  if (ver == null) {
    // FL-HC1: unresolvable pin (e.g. shallow clone) is a warn, not a hard error
    return {
      severity: "warn",
      message: `cannot resolve SCHEMA_VERSION for eventsPin ${short(pin.sha)} (e.g. shallow clone) — runtime binding unverified`,
    };
  }
  if (ver === ACVP_L1_SCHEMA_VERSION) {
    return {
      severity: "ok",
      message: `envelope-bound to ${ACVP_L1_SCHEMA_VERSION} via eventsPin ${short(pin.sha)}`,
    };
  }
  return {
    severity: "error",
    message: `eventsPin ${short(pin.sha)} resolves to '${ver}', not '${ACVP_L1_SCHEMA_VERSION}' (vocabulary misuse)`,
  };
}

function short(sha: string): string {
  return sha.length > 8 ? sha.slice(0, 8) : sha;
}

// entry.expires is YYYY-MM-DD; valid through that day inclusive (UTC date compare).
// FAIL CLOSED (FAGAN gpt+composer): a malformed/empty `expires` is treated as
// EXPIRED so an allowlist typo (e.g. "2026-99-99") can never grant a permanent
// aspirational pass via a lexicographic comparison that silently never trips.
function isExpired(expires: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) return true;
  // Round-trip through UTC (FAGAN iter-2 gpt): reject impossible dates instead of
  // letting JS normalize them into a later valid date (2026-13-01 → 2027-01-01).
  const d = new Date(expires + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== expires) return true;
  return now.toISOString().slice(0, 10) > expires;
}

export const validateAcvpBindings = (input: ValidateAcvpBindingsInput): AcvpBindingReport => {
  const now = input.now ?? new Date(); // FL-D0: caller SHOULD inject for determinism
  const checkedAt = now.toISOString();
  const findings: AcvpBindingFinding[] = [];

  for (const inv of input.beacon.acvp_invariants ?? []) {
    const raw: Array<{ binding: AcvpBindingType } & Raw> = [];
    raw.push({ binding: "proof", ...rawProofFinding(inv, input) });
    const runtime = rawRuntimeFinding(inv, input);
    if (runtime) raw.push({ binding: "runtime", ...runtime });

    if (inv.status === "aspirational") {
      const entry = input.aspirationalAllowlist.find(
        (e) => e.slug === input.slug && e.id === inv.id,
      );
      if (!entry) {
        findings.push({
          slug: input.slug, invariant_id: inv.id, binding: "proof",
          severity: "error", check: `acvp_proof:${inv.id}`,
          message: `status:aspirational but NOT in .freeside/acvp-aspirational-allowlist.yaml — silent aspiration is forbidden (default-FAIL)`,
        });
        continue;
      }
      if (isExpired(entry.expires, now)) {
        findings.push({
          slug: input.slug, invariant_id: inv.id, binding: "proof",
          severity: "error", check: `acvp_proof:${inv.id}`,
          message: `status:aspirational allowlist entry EXPIRED ${entry.expires} — promote (back the proof) or re-date`,
          aspirational_until: entry.expires,
        });
        continue;
      }
      // pre-expiry: an explicitly-aspirational invariant is NEVER `bound` (FAGAN
      // iter-2 gpt) — every finding surfaces as `warn` w/ countdown (contract
      // → aspirational), signaling "promote status:active once truly backed".
      for (const r of raw) {
        findings.push({
          slug: input.slug, invariant_id: inv.id, binding: r.binding,
          severity: "warn", check: `acvp_${r.binding}:${inv.id}`,
          message: `[aspirational until ${entry.expires}] ${r.message}`,
          aspirational_until: entry.expires,
        });
      }
      continue;
    }

    // status: active (default) — raw findings stand
    for (const r of raw) {
      findings.push({
        slug: input.slug, invariant_id: inv.id, binding: r.binding,
        severity: r.severity, check: `acvp_${r.binding}:${inv.id}`,
        message: r.message,
      });
    }
  }

  const summary = {
    ok: findings.filter((f) => f.severity === "ok").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    error: findings.filter((f) => f.severity === "error").length,
  };
  // G-12: bound requires ALL applicable findings ok; an aspirational warn cannot yield bound.
  const contract_status: AcvpBindingReport["contract_status"] =
    summary.error > 0 ? "broken" : summary.warn > 0 ? "aspirational" : "bound";

  return { slug: input.slug, checked_at: checkedAt, findings, summary, contract_status };
};
