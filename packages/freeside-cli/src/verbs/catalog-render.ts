/**
 * Pure renderers for the building-awareness catalog.
 *
 * Kept free of runtime dependencies (the `BuildingCatalog` import is type-only,
 * erased at compile time) so the FREESIDE.md generator + the gateway can render
 * a catalog without dragging in the registry loader.
 *
 * SECURITY: beacon content (one_liner, is_not, capabilities) is fetched from
 * external building repos and is UNTRUSTED. The awareness doc is consumed by
 * agents as authoritative, so every beacon-derived scalar is passed through
 * `inline()` before interpolation — collapsing newlines (which would otherwise
 * break out of a blockquote/list line and inject headings/structure into the
 * doc). Mirrors the cross-repo-reader rule: treat external content as opaque.
 */

import type { BuildingCatalog } from "@0xhoneyjar/freeside-registry";

/**
 * The canonical composition DAG (ADR-008 §D-3): data semantic depth runs one
 * way — raw → derived → integrated → presented. Belts only run downstream.
 * Static (not beacon-derived) because composes_with tags aren't sealed yet
 * (see each beacon's `_comment`); grounded in the ADR, not invented here.
 */
const DAG_TIERS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["RAW (events · bytes)", ["sonar-api", "storage-api"]],
  ["DERIVED (state)", ["inventory-api", "mint-api", "activities-api"]],
  ["INTEGRATED (meaning)", ["score-api"]],
  ["PRESENTED (UX boundary)", ["mediums-api"]],
];

const host = (url: string): string => url.replace(/^https?:\/\//, "").split("/")[0];

const repoPath = (url: string): string =>
  url.replace(/^https?:\/\//, "").replace(/\.git$/, "");

/** Neutralize untrusted beacon scalars for safe inline interpolation. */
const inline = (s: string): string => s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/** As `inline`, but also strips backticks that would break a markdown code span. */
const inlineCode = (s: string): string => inline(s).replace(/`/g, "");

const stripPrefix = (s: string): string =>
  s.replace(/^(Does NOT|Will NOT|Refuses to) /, "");

const renderBuildingCard = (b: BuildingCatalog["buildings"][number]): string => {
  const lines: string[] = [];
  const status = b.status ?? "—";
  const rename = b.rename ? ` · rename:${b.rename}` : "";
  lines.push(`### \`${b.slug}\`  ·  ${status}  ·  ${b.visibility}${rename}`);
  if (b.reachable && b.one_liner) {
    lines.push("");
    lines.push(`> ${inline(b.one_liner)}`);
    if (b.is_not && b.is_not.length) {
      lines.push("");
      lines.push(`**Refuses** · ${b.is_not.map((s) => inline(stripPrefix(s))).join(" · ")}`);
    }
    if (b.capabilities && b.capabilities.length) {
      lines.push(`**Capabilities** · ${b.capabilities.map((c) => `\`${inlineCode(c)}\``).join(" · ")}`);
    }
    const mcp = b.has_mcp ? "MCP ✓" : "MCP — (not yet deployed)";
    lines.push(`**Reach** · ${mcp} · beacon \`${host(b.beacon_url)}\` · repo \`${repoPath(b.git_url)}\``);
  } else {
    lines.push("");
    lines.push(`> ⏳ registered, beacon not broadcasting yet — \`${host(b.beacon_url)}\``);
    lines.push(`**Reach** · repo \`${repoPath(b.git_url)}\``);
  }
  return lines.join("\n");
};

const renderDag = (present: ReadonlySet<string>): string => {
  const tiered = new Set(DAG_TIERS.flatMap(([, slugs]) => slugs));
  const rows = DAG_TIERS.map(([tier, slugs]) => {
    const shown = slugs.filter((s) => present.has(s));
    return `  ${tier.padEnd(26)}${shown.length ? shown.join(", ") : "—"}`;
  });
  // Orphan visibility: a registered building not placed in any tier must be
  // shown AS untiered, not silently dropped from the DAG (it'd vanish).
  const untiered = [...present].filter((s) => !tiered.has(s));
  if (untiered.length) {
    rows.push(`  ${"UNTIERED (unplaced)".padEnd(26)}${untiered.join(", ")}`);
  }
  return ["```", "  belts run ONE way — raw → presented (ADR-008 §D-3)", "", ...rows, "```"].join("\n");
};

export const renderCatalogMarkdown = (c: BuildingCatalog): string => {
  const present = new Set(c.buildings.map((b) => b.slug));
  const reachable = c.buildings.filter((b) => b.reachable).length;
  const out: string[] = [];
  out.push("# The Freeside Building Network");
  out.push("");
  out.push(
    "> Auto-generated awareness surface — **do not hand-edit**. Regenerate: `loa freeside catalog --format md`.",
  );
  out.push(">");
  out.push(
    "> Each **building** is one repo: a sealed substrate/contract core + an API · MCP · CLI surface to read it from outside. " +
      "Point a Loa agent at this map (or the machine twin `/.well-known/buildings.json`) to discover what exists and wire it in as a first-class tool — like the constructs network, for buildings.",
  );
  out.push("");
  out.push(
    `**${c.building_count} buildings** · ${reachable} broadcasting a valid beacon · generated ${c.generated_at.slice(0, 10)}`,
  );
  out.push("");
  out.push("## Factory floor — the composition DAG");
  out.push("");
  out.push(renderDag(present));
  out.push("");
  out.push(
    "_A building consumes only buildings upstream of it (closer to raw). Bottleneck debugging = walk upstream on the belts._",
  );
  out.push("");
  out.push("## Buildings");
  out.push("");
  for (const b of c.buildings) {
    out.push(renderBuildingCard(b));
    out.push("");
  }
  out.push("---");
  out.push("");
  out.push(
    "**Wiring it in (agents):** read this catalog (or `curl <gateway>/.well-known/buildings.json`), pick the building whose `Refuses`/`Capabilities` match your need, and reach it via its MCP tenant (when `MCP ✓`) or its repo. " +
      "`loa freeside inspect <slug>` returns the full beacon; `loa freeside doctor` audits health.",
  );
  return out.join("\n");
};

export const renderCatalogJson = (c: BuildingCatalog): string => JSON.stringify(c, null, 2);
