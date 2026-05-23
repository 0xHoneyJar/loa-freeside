/**
 * `loa freeside list` — show registered `*-api` buildings.
 *
 * Reads the L1 registry (packages/freeside-registry/registry.yaml) and
 * prints each registered building, including its repo-rename status. Does NOT
 * fetch beacons (no network calls); for full beacon detail use
 * `loa freeside inspect <slug>`.
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6
 *            decisions/008-freeside-as-factory.md §D-11
 */

import { loadRegistry, type Registry } from "@freeside/freeside-registry";

export interface ListOutput {
  readonly modules: ReadonlyArray<{
    readonly slug: string;
    readonly visibility: string;
    readonly owner: string;
    readonly beacon_url: string;
    readonly rename?: "done" | "pending";
  }>;
}

export const listModules = (deps: { registry?: Registry } = {}): ListOutput => {
  const registry = deps.registry ?? loadRegistry();
  const modules = Object.entries(registry.modules).map(([slug, entry]) => ({
    slug,
    visibility: entry.visibility,
    owner: entry.owner,
    beacon_url: entry.beacon_url,
    rename: entry.rename,
  }));
  return { modules };
};

export const printList = (output: ListOutput): string => {
  const lines: string[] = [
    `Registered *-api buildings (${output.modules.length}):`,
    "",
  ];
  const maxSlug = Math.max(...output.modules.map((m) => m.slug.length));
  for (const m of output.modules) {
    const pad = " ".repeat(maxSlug - m.slug.length);
    const rename = m.rename ? `  rename:${m.rename}` : "";
    lines.push(
      `  ${m.slug}${pad}  [${m.visibility.padEnd(8)}]  ${m.owner}${rename}`,
    );
  }
  return lines.join("\n");
};
