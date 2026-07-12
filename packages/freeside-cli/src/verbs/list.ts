/**
 * `loa freeside list` — show registered modules with one-liners.
 *
 * Reads the L1 registry (packages/freeside-registry/registry.yaml) and
 * prints each registered module. Does NOT fetch beacons (no network calls);
 * for full beacon detail use `loa freeside inspect <slug>`.
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6
 */

import { loadRegistry } from "@freeside/freeside-registry";

export interface ListOutput {
  readonly modules: ReadonlyArray<{
    readonly slug: string;
    readonly visibility: string;
    readonly owner: string;
    readonly beacon_url: string | null;
  }>;
}

export const listModules = (): ListOutput => {
  const registry = loadRegistry();
  const modules = Object.entries(registry.modules).map(([slug, entry]) => ({
    slug,
    visibility: entry.visibility,
    owner: entry.owner,
    beacon_url: entry.beacon_url,
  }));
  return { modules };
};

export const printList = (output: ListOutput): string => {
  const lines: string[] = [
    `Registered freeside-* modules (${output.modules.length}):`,
    "",
  ];
  const maxSlug = Math.max(...output.modules.map((m) => m.slug.length));
  for (const m of output.modules) {
    const pad = " ".repeat(maxSlug - m.slug.length);
    lines.push(`  ${m.slug}${pad}  [${m.visibility.padEnd(8)}]  ${m.owner}`);
  }
  return lines.join("\n");
};
