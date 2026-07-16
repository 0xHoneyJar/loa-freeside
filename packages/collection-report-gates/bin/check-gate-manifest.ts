#!/usr/bin/env node
/**
 * check-gate-manifest · deterministic CR-019 gate-manifest checker
 *
 * Usage:
 *   check-gate-manifest --manifest <gates.yaml> [--source <task-manifest.yaml>]
 *     [--approval-keyring <trusted-owners.yaml>] [--json]
 *
 * Validation stages (all deterministic; expiry is judged against the
 * manifest's own evaluated_at, never wall clock):
 *   1. range scan on raw task-reference positions (specific RANGE_FORBIDDEN)
 *   2. Effect Schema shape decode (missing validity policy etc.)
 *   3. semantic validation (unknown/missing CRs, expired evidence, duplicate
 *      primary ownership, impossible branches, dependency cycles, premature
 *      flags, tier/checkpoint summary-vs-closure drift, no-go consequences)
 *   4. optional coordinator task-manifest cross-check (--source): digest +
 *      inventory coverage in both directions
 *
 * Exit codes: 0 = valid · 1 = findings · 2 = usage/IO error
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { Either, ParseResult } from "effect";
import {
  decodeApprovalKeyringSync,
  decodeGateManifestEither,
} from "../src/schema.js";
import {
  scanRawTaskRefs,
  validateGateManifest,
  flattenTaskManifest,
  type Finding,
  type ValidationResult,
} from "../src/validate.js";

const args = process.argv.slice(2);
const argValue = (flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
};
const manifestPath = argValue("--manifest");
const sourcePath = argValue("--source");
const approvalKeyringPath = argValue("--approval-keyring");
const jsonOutput = args.includes("--json");

if (!manifestPath) {
  console.error(
    "usage: check-gate-manifest --manifest <gates.yaml> [--source <task-manifest.yaml>] [--approval-keyring <trusted-owners.yaml>] [--json]",
  );
  process.exit(2);
}

let raw: unknown;
try {
  raw = parse(readFileSync(manifestPath, "utf-8"));
} catch (err) {
  console.error(`[check-gate-manifest] cannot read/parse ${manifestPath}: ${String(err)}`);
  process.exit(2);
}

const report = (result: ValidationResult): never => {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      console.log(`ERROR ${f.code} at ${f.path}: ${f.message}`);
    }
    for (const t of result.tiers) {
      const status = t.reachable
        ? "reachable"
        : `IMPOSSIBLE (no_go: ${t.blocking_no_go_gates.join(", ")})`;
      console.log(`tier ${t.tier}: ${status} · closure ${t.closure_size} tasks`);
    }
    console.log(
      result.valid
        ? "VALID — 0 findings"
        : `INVALID — ${result.findings.length} finding(s)`,
    );
  }
  process.exit(result.valid ? 0 : 1);
};

// Stage 1 — raw range scan (specific error before schema pattern rejection)
const rangeFindings = scanRawTaskRefs(raw);
if (rangeFindings.length > 0) {
  report({ valid: false, findings: rangeFindings, tiers: [] });
}

// Stage 2 — shape decode
const decoded = decodeGateManifestEither(raw);
const manifest = Either.match(decoded, {
  onLeft: (error) => {
    const finding: Finding = {
      code: "SCHEMA_INVALID",
      path: "$",
      message: ParseResult.TreeFormatter.formatErrorSync(error),
    };
    return report({ valid: false, findings: [finding], tiers: [] });
  },
  onRight: (value) => value,
});

// Stage 3/4 — semantic validation (+ optional source cross-check)
let source;
if (sourcePath) {
  try {
    const bytes = readFileSync(sourcePath);
    source = {
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      tasks: flattenTaskManifest(parse(bytes.toString("utf-8"))),
    };
  } catch (err) {
    console.error(`[check-gate-manifest] cannot read/parse ${sourcePath}: ${String(err)}`);
    process.exit(2);
  }
}

let approvalAuthorities;
if (approvalKeyringPath) {
  try {
    const keyring = decodeApprovalKeyringSync(
      parse(readFileSync(approvalKeyringPath, "utf-8")),
    );
    approvalAuthorities = new Map(
      keyring.authorities.map((authority) => [
        authority.owner,
        {
          key_id: authority.key_id,
          public_key: authority.public_key,
        },
      ]),
    );
  } catch (err) {
    console.error(
      `[check-gate-manifest] cannot read/parse ${approvalKeyringPath}: ${String(err)}`,
    );
    process.exit(2);
  }
}

report(validateGateManifest(manifest, { source, approvalAuthorities }));
