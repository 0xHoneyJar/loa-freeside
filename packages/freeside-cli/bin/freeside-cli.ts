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

const usage = `freeside-cli — ecosystem CLI for freeside-* module network

Usage:
  freeside-cli list                  Show registered modules with one-liners
  freeside-cli inspect <slug>        Show beacon for a specific module
  freeside-cli doctor                Audit all modules against BeaconV3 schema

Reference: decisions/007-loa-freeside-absorption.md §D-6
`;

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
      if (!slug) {
        console.error("Error: 'inspect' requires a module slug.");
        console.error("       freeside-cli inspect <slug>");
        return 2;
      }
      try {
        const output = await inspectModule(slug);
        console.log(JSON.stringify(output, null, 2));
        return 0;
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }
    case "doctor": {
      const report = doctor();
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
    default: {
      console.error(`Error: unknown verb '${verb}'`);
      console.error(usage);
      return 2;
    }
  }
};

process.exit(await main());
