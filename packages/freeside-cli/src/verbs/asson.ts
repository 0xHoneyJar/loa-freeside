import fs from "node:fs";
import path from "node:path";
import {
  doctor,
  harvestVector,
  createSigner,
  attestBuild,
  verifyAttestation,
  toCommandPolicy,
} from "@freeside/asson";
import { livenessVerdict, DEFAULT_POLICY } from "@freeside/asson/liveness";

const usage = `freeside-cli asson — instrument of invocation

Usage:
  freeside-cli asson doctor <dir> [--public-key <pem-file>] [--keyring <path>]
  freeside-cli asson harvest <dir> --name <name> -- <argv...>
  freeside-cli asson attest <dir> [--write]
  freeside-cli asson policy <dir>
  freeside-cli asson watchdog <span-log.jsonl> [--now <ms>] [--p95 <s>] [--json]
`;

/**
 * watchdog <span-log.jsonl> — the liveness verdict over a Legba span log (cycle 4).
 * Reads the recorded span moves and runs @freeside/asson/liveness#livenessVerdict;
 * the action (reap/checkpoint/compact/warn/pace_alert/continue) is what a SubagentStop
 * hook would act on. Exit: 0 continue/ok · 3 warn|pace_alert · 1 intervention required.
 * SENSOR only — reads Legba's output, never modifies Legba (the seam is one-way).
 */
function assonWatchdog(args: string[]): number {
  const logPath = args[0];
  if (!logPath || logPath.startsWith("--")) {
    console.error("Error: 'asson watchdog' requires a <span-log.jsonl>.");
    return 2;
  }
  if (!fs.existsSync(logPath)) {
    console.error(`Error: span log not found: ${logPath}`);
    return 2;
  }
  const flagN = (n: string): string | undefined => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  let log: unknown[];
  try {
    log = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch (err) {
    console.error(`Error: ${logPath} is not valid JSONL (${err instanceof Error ? err.message : String(err)})`);
    return 1;
  }
  const p95 = flagN("--p95");
  const policy = p95 ? { ...DEFAULT_POLICY, pace: { p95_s: Number(p95) } } : DEFAULT_POLICY;
  const now = flagN("--now");
  const opts = now ? { nowMs: Number(now) } : {};
  const v = livenessVerdict(log as never[], policy, opts);
  if (args.includes("--json")) {
    console.log(JSON.stringify(v, null, 2));
  } else {
    console.log(`action: ${v.action}`);
    if (v.stall?.stalled) console.log(`  stall: silent ${v.stall.silent_s}s`);
    if (v.spin?.spinning) console.log(`  spin: ${v.spin.max_repeats}× ${v.spin.repeated.join(", ")}`);
    if (v.budget) console.log(`  budget: ${v.budget.calls} calls, ${v.budget.wall_s}s, phase ${v.budget.phase}`);
    if (v.pace?.tracked && v.pace.off_pace) console.log(`  pace: ${v.pace.wall_s}s > p95 ${v.pace.p95_s}s`);
  }
  const intervene = ["reap", "checkpoint_and_present", "compact_then_present", "compact"];
  return intervene.includes(v.action) ? 1 : v.action === "warn" || v.action === "pace_alert" ? 3 : 0;
}

export async function assonVerb(args: string[]): Promise<number> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(usage);
    return sub ? 0 : 2;
  }

  if (sub === "watchdog") return assonWatchdog(args.slice(1));

  const dir = args[1];
  if (!dir || dir.startsWith("--")) {
    console.error(`Error: 'asson ${sub}' requires a <dir> argument.`);
    return 2;
  }

  const vevePath = path.join(dir, "veve.json");
  if (!fs.existsSync(vevePath)) {
    console.error(`Error: veve.json not found in ${dir}`);
    return 1;
  }

  let veve: ReturnType<typeof JSON.parse>;
  try {
    veve = JSON.parse(fs.readFileSync(vevePath, "utf8"));
  } catch (err) {
    console.error(`Error: ${vevePath} is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    return 1;
  }

  switch (sub) {
    case "doctor": {
      // --public-key <pem-file>: ed25519 keys cannot be carried as a raw argv string,
      // so the flag names a PEM file the doctor reads to verify the attestation. Without
      // it the doctor is fail-closed (attestation → unattested). The cycle-3 keyring will
      // resolve the key from signed_by_key_id; until then it is passed explicitly.
      const keyPathIndex = args.indexOf("--public-key");
      const keyPath = keyPathIndex >= 0 ? args[keyPathIndex + 1] : null;
      let publicKey: string | null = null;
      if (keyPath) {
        if (!fs.existsSync(keyPath)) {
          console.error(`Error: --public-key file not found: ${keyPath}`);
          return 2;
        }
        publicKey = fs.readFileSync(keyPath, "utf8");
      }
      // --keyring <path>: resolve the verifying key BY signed_by_key_id (cycle-3 binding).
      const krIndex = args.indexOf("--keyring");
      const krPath = krIndex >= 0 ? args[krIndex + 1] : null;
      let keyring = null;
      if (krPath) {
        if (!fs.existsSync(krPath)) {
          console.error(`Error: --keyring file not found: ${krPath}`);
          return 2;
        }
        keyring = JSON.parse(fs.readFileSync(krPath, "utf8"));
      }

      let report;
      try {
        report = doctor(veve, dir, { publicKey, keyring });
      } catch (err) {
        console.error(`Error: doctor failed (${err instanceof Error ? err.message : String(err)}) — is --public-key a valid PEM?`);
        return 1;
      }

      console.log(`Earned: L${report.earned} (${report.attestation_tier})`);
      if (report.findings.length > 0) {
        console.log("Findings:");
        for (const f of report.findings) {
          console.log(`  [${f.severity.toUpperCase()}] ${f.as_id}: ${f.message}`);
        }
      }
      return report.exit;
    }

    case "harvest": {
      const nameIndex = args.indexOf("--name");
      if (nameIndex < 0 || !args[nameIndex + 1]) {
        console.error("Error: harvest requires --name <name>");
        return 2;
      }
      const name = args[nameIndex + 1];
      const dashDashIndex = args.indexOf("--");
      const argv = dashDashIndex >= 0 ? args.slice(dashDashIndex + 1) : [];

      // B7 determinism guard: run the CLI TWICE and refuse to pin if the output
      // hashes differ. The library's harvestVector runs once, so the empirical
      // double-run check lives here. A tool whose two runs disagree is actually
      // `attestable` (pin under an injected clock/seed), never `re_executable`.
      const v1 = harvestVector(veve, dir, { name, argv });
      const v2 = harvestVector(veve, dir, { name, argv });
      if (v1.expect_output_hash !== v2.expect_output_hash) {
        console.error(
          `Error: non-deterministic — two runs produced different output hashes; refusing to pin '${name}'.\n` +
            `  run 1: ${v1.expect_output_hash}\n  run 2: ${v2.expect_output_hash}\n` +
            `  declare determinism.class=attestable (pin under an injected clock/seed) instead.`,
        );
        return 1;
      }

      veve.vectors = veve.vectors || [];
      veve.vectors.push(v1);
      fs.writeFileSync(vevePath, JSON.stringify(veve, null, 2) + "\n");
      console.log(`Harvested vector '${name}'.`);
      return 0;
    }

    case "attest": {
      const write = args.includes("--write");
      const signer = createSigner();
      const attested = attestBuild(veve, dir, signer);
      
      if (!write) {
        console.log(JSON.stringify(attested, null, 2));
        return 0;
      }

      // Pre-persist verification
      const verify = verifyAttestation(attested, dir, signer.publicKey);
      if (!verify.ok) {
        console.error("Error: pre-persist verification failed. Refusing to write.", verify.reason || verify.checks);
        return 1;
      }

      fs.writeFileSync(vevePath, JSON.stringify(attested, null, 2) + "\n");
      console.log(`Attested ${dir} with dev_signature.`);
      return 0;
    }

    case "policy": {
      const policy = toCommandPolicy(veve, dir);
      console.log(JSON.stringify(policy, null, 2));
      return 0;
    }

    default: {
      console.error(`Error: unknown asson subcommand '${sub}'`);
      console.error(usage);
      return 2;
    }
  }
}
