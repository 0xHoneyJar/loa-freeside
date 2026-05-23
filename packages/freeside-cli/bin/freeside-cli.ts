#!/usr/bin/env node
/**
 * freeside-cli — entry point for the `loa freeside <verb>` ecosystem CLI.
 *
 * Verbs:
 *   list                  — show registered buildings
 *   inspect <slug>        — show beacon for a building
 *   doctor                — audit all buildings against BeaconV3 schema
 *   catalog [--format]    — building-awareness surface (md | json)
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6
 *            decisions/008-freeside-as-factory.md §D-11
 */

import { listModules, printList } from "../src/verbs/list.js";
import { inspectModule } from "../src/verbs/inspect.js";
import { doctor } from "../src/verbs/doctor.js";
import { catalog, renderCatalogMarkdown, renderCatalogJson } from "../src/verbs/catalog.js";

const usage = `freeside-cli — ecosystem CLI for the freeside building network

Usage:
  freeside-cli list                  Show registered *-api buildings
  freeside-cli inspect <slug>        Show beacon for a specific building
  freeside-cli doctor                Audit all buildings against BeaconV3 schema
  freeside-cli catalog [--format md|json]
                                     Awareness surface — what exists + how to wire it in

Reference: decisions/007-loa-freeside-absorption.md §D-6 · 008 §D-11
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
      const report = await doctor();
      console.log(JSON.stringify(report, null, 2));
      // Exit non-zero if any errors found
      return report.summary.error > 0 ? 1 : 0;
    }
    case "catalog": {
      const fmtIdx = args.indexOf("--format");
      const fmt = fmtIdx >= 0 ? args[fmtIdx + 1] : "md";
      const cat = await catalog();
      console.log(fmt === "json" ? renderCatalogJson(cat) : renderCatalogMarkdown(cat));
      return 0;
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

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
