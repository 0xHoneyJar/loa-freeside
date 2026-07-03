#!/usr/bin/env node
/**
 * freeside-cli — entry point for the `loa freeside <verb>` ecosystem CLI.
 *
 * Verbs:
 *   list                  — show registered modules
 *   inspect <slug>        — show beacon for a module
 *   doctor                — audit all modules against BeaconV3 schema
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6
 */

import { listModules, printList } from "../src/verbs/list.js";
import { inspectModule } from "../src/verbs/inspect.js";
import { doctor } from "../src/verbs/doctor.js";
import { orderVerb } from "../src/verbs/order.js";
import { kitchenVerb } from "../src/verbs/kitchen.js";
import { fulfillVerb } from "../src/verbs/fulfill.js";

const usage = `freeside-cli — ecosystem CLI for freeside-* module network

Usage:
  freeside-cli list                  Show registered modules with one-liners
  freeside-cli inspect <slug>        Show beacon for a specific module
  freeside-cli doctor [--remote] [--acvp] [--baseline <reg>] [--registry <reg>] [--cells-dir <dir>]
                                     Audit all modules against BeaconV3 + ACVP bindings.
                                     --remote: host-pinned live probe of each declared
                                       beacon_url + host-integrity guard (SC-6). A
                                       public+deployed cell whose beacon is dark → warn;
                                       scaffolded/not-built cells are exempt.
                                     --cells-dir <dir>: resolve each cell's beacon + ACVP
                                       inputs from a per-cell clone at <dir>/cell-<slug>/
                                       (the per-cell resolution bridge — backed buildings
                                       report contract_status: bound).

Ordering zone (fulfillment-surface v0.3 — env: ORDERING_SERVICE_URL, ORDERING_SERVICE_TOKEN):
  freeside-cli order place --preset <p> --inputs <@file|json> [--placed-by <who>]
  freeside-cli order status <order_id>
  freeside-cli order ingredients <order_id>
  freeside-cli kitchen probe <order_id> [--ingredient <i>]      (fresh probe; ambiguous → exit 4)
  freeside-cli kitchen advance <order_id> --ingredient <i> --status <s> [--note <text>]
  freeside-cli fulfill watch <order_id> [--interval <s>] [--timeout <s>] [--once]
  Output: single-line JSON. Exit codes: 0 ok · 1 usage · 2 unreachable · 3 API error ·
  4 ambiguous/conflict · 5 watch timeout · 6 order failed.

Reference: decisions/007-loa-freeside-absorption.md §D-6
`;

const flagValue = (flags: string[], name: string): string | undefined => {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : undefined;
};

const main = async (): Promise<number> => {
  const args = process.argv.slice(2);
  const verb = args[0];

  switch (verb) {
    case "list": {
      const output = listModules();
      console.log(printList(output));
      return 0;
    }
    case "inspect": {
      const slug = args[1];
      if (!slug || slug.startsWith("--")) {
        console.error("Error: 'inspect' requires a module slug.");
        console.error("       freeside-cli inspect <slug> [--raw] [--pretty]");
        return 64; // EX_USAGE — distinct from unknown_slug (exit 1), so an agent can tell 'called wrong' from 'no such slug' (BC-009)
      }
      const flags = args.slice(2);
      const result = await inspectModule(slug);
      const pretty = flags.includes("--pretty");
      const fmt = (v: unknown) => (pretty ? JSON.stringify(v, null, 2) : JSON.stringify(v));
      if (result.error) {
        console.log(fmt(result.error));
        return result.exit;
      }
      if (flags.includes("--raw")) {
        console.log(fmt({ raw: result.raw ?? null, verdict: result.packet?.verdict ?? null }));
      } else {
        console.log(fmt(result.packet));
      }
      return result.exit;
    }
    case "doctor": {
      const flags = args.slice(1);
      const report = await doctor({
        remote: flags.includes("--remote"),
        acvpOnly: flags.includes("--acvp"),
        baselineRegistryPath: flagValue(flags, "--baseline"),
        registryPath: flagValue(flags, "--registry"),
        cellsDir: flagValue(flags, "--cells-dir"),
      });
      console.log(JSON.stringify(report, null, 2));
      // Exit non-zero if any errors found
      return report.summary.error > 0 ? 1 : 0;
    }
    case "--help":
    case "-h":
    case undefined: {
      console.log(usage);
      return 0;
    }
    case "order": {
      return orderVerb(args.slice(1));
    }
    case "kitchen": {
      return kitchenVerb(args.slice(1));
    }
    case "fulfill": {
      return fulfillVerb(args.slice(1));
    }
    default: {
      console.error(`Error: unknown verb '${verb}'`);
      console.error(usage);
      return 2;
    }
  }
};

process.exit(await main());
