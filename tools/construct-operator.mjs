#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSystemComponent } from "./system-component.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SYSTEM = "product/system-components/loa-freeside.system.json";

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

function normalizeExecutionContract(capabilities) {
  requireObject(capabilities, "constructs capabilities");
  if (!Array.isArray(capabilities.verbs)) {
    throw new Error("constructs capabilities.verbs must be an array");
  }
  const verbs = capabilities.verbs.map((verb) => ({
    name: verb.name,
    summary: verb.summary,
    flags: Array.isArray(verb.flags) ? [...verb.flags] : [],
  }));
  const mutationNames = new Set(
    capabilities.verbs.filter((verb) => verb.mutation === true).map((verb) => verb.name),
  );
  return {
    tool: capabilities.tool,
    version: capabilities.version,
    contract_version: capabilities.contract_version,
    determinism: capabilities.determinism,
    info_contract: capabilities.info_contract ?? null,
    atlas_contract: capabilities.atlas_contract ?? null,
    read_verbs: verbs.filter((verb) => !mutationNames.has(verb.name)).toSorted(byName),
    mutation_verbs: verbs.filter((verb) => mutationNames.has(verb.name)).toSorted(byName),
    exit_codes: capabilities.exit_codes,
  };
}

function unavailableConstruct(slug, reason) {
  return {
    slug,
    orientation: {
      available: false,
      kind: "unavailable",
      authoritative: false,
      description: null,
      reason,
    },
    mechanics: {
      available: false,
      kind: "unavailable",
      authority_effect: "none",
      reason,
      skills: [],
      commands: [],
    },
    provenance: null,
    drift: [],
  };
}

function normalizeConstructInfo(slug, payload) {
  if (!payload || payload.error) {
    return unavailableConstruct(slug, payload?.error?.message ?? "construct info was not available");
  }
  const data = requireObject(payload.data, `constructs info ${slug}.data`);
  if (data.info_schema_version !== "1.0") {
    throw new Error(`constructs info ${slug}: producer does not expose info_schema_version 1.0`);
  }
  const orientation = requireObject(data.orientation, `constructs info ${slug}.orientation`);
  if (orientation.kind !== "prose" || orientation.authoritative !== false) {
    throw new Error(`constructs info ${slug}: orientation must be non-authoritative prose`);
  }
  const mechanics = requireObject(data.mechanics, `constructs info ${slug}.mechanics`);
  if (mechanics.authority_effect !== "none") {
    throw new Error(`constructs info ${slug}: mechanics cannot grant authority`);
  }
  if (!new Set(["declared", "unavailable"]).has(mechanics.kind)) {
    throw new Error(`constructs info ${slug}: unknown mechanics kind ${JSON.stringify(mechanics.kind)}`);
  }

  return {
    slug,
    orientation: {
      available: true,
      kind: "prose",
      authoritative: false,
      description: orientation.description ?? "",
      short_description: orientation.short_description ?? null,
      domains: Array.isArray(orientation.domains) ? [...orientation.domains].toSorted() : [],
      persona_ref: orientation.persona_ref ?? null,
      expertise_ref: orientation.expertise_ref ?? null,
    },
    mechanics: {
      available: mechanics.kind === "declared",
      kind: mechanics.kind,
      authority_effect: "none",
      reason: mechanics.reason ?? null,
      source_refs: Array.isArray(mechanics.source_refs) ? [...mechanics.source_refs].toSorted() : [],
      skills: Array.isArray(mechanics.skills)
        ? mechanics.skills.map((skill) => ({
          slug: skill.slug,
          path: skill.path ?? null,
          metadata_status: skill.metadata_status ?? "unknown",
          capabilities: skill.capabilities ?? null,
        })).toSorted((a, b) => a.slug.localeCompare(b.slug))
        : [],
      commands: Array.isArray(mechanics.commands)
        ? mechanics.commands.map((command) => ({ name: command.name, path: command.path ?? null })).toSorted(byName)
        : [],
    },
    provenance: payload.provenance ?? null,
    drift: Array.isArray(payload.drift) ? payload.drift : [],
  };
}

const AUTHORITY_RANK = new Map([
  ["observe", 0],
  ["advise", 1],
  ["gate", 2],
]);

function normalizeAuthority(stationing) {
  const ceiling = stationing.authority_ceiling ?? "observe";
  const earned = stationing.authority_earned ?? "unknown";
  const effective = stationing.authority_effective ?? "observe";
  if (!AUTHORITY_RANK.has(ceiling)) {
    throw new Error(`constructs atlas ${stationing.construct}: unknown authority ceiling ${JSON.stringify(ceiling)}`);
  }
  if (earned !== "unknown" && !AUTHORITY_RANK.has(earned)) {
    throw new Error(`constructs atlas ${stationing.construct}: unknown earned authority ${JSON.stringify(earned)}`);
  }
  if (!AUTHORITY_RANK.has(effective)) {
    throw new Error(`constructs atlas ${stationing.construct}: unknown effective authority ${JSON.stringify(effective)}`);
  }
  if (earned === "unknown" && effective !== "observe") {
    throw new Error(`constructs atlas ${stationing.construct}: unknown earned authority must collapse to observe`);
  }
  if (AUTHORITY_RANK.get(effective) > AUTHORITY_RANK.get(ceiling)) {
    throw new Error(`constructs atlas ${stationing.construct}: effective authority exceeds its territory ceiling`);
  }
  if (earned !== "unknown" && AUTHORITY_RANK.get(effective) > AUTHORITY_RANK.get(earned)) {
    throw new Error(`constructs atlas ${stationing.construct}: effective authority exceeds earned evidence`);
  }
  return {
    source: "territory ceiling intersected with earned authority",
    ceiling,
    earned,
    effective,
    grants_from_prose: false,
  };
}

function integrityStatus({ atlas, constructs }) {
  const missing = constructs.some((construct) => !construct.orientation.available || !construct.mechanics.available);
  const drift = constructs.some((construct) => construct.drift.length > 0)
    || (Array.isArray(atlas.conflicts) && atlas.conflicts.length > 0);
  if (drift) return "drift";
  const ratified = atlas.ratification_status === "ratified";
  if (atlas.partial || missing || !ratified) return "partial";
  return "ok";
}

export function buildConstructOperatorSurface({ component, snapshot, regionId }) {
  const validation = validateSystemComponent(component, { repoRoot: ROOT });
  if (!validation.valid) {
    throw new Error(`system component is invalid: ${validation.errors.join("; ")}`);
  }
  requireObject(snapshot, "construct snapshot");
  const atlas = requireObject(snapshot.atlas, "construct snapshot.atlas");
  const executionContract = normalizeExecutionContract(snapshot.capabilities);
  const selectedRegion = regionId ?? component.component_id;
  const region = (atlas.regions ?? []).find((candidate) => candidate.region === selectedRegion);
  if (!region) throw new Error(`construct atlas has no region named ${selectedRegion}`);

  const outcomes = new Map((region.outcomes ?? []).map((outcome) => [outcome.id, outcome.description]));
  const constructs = (region.loadout ?? []).map((stationing) => {
    const info = normalizeConstructInfo(stationing.construct, snapshot.info?.[stationing.construct]);
    info.answers_for = [...stationing.outcomes].toSorted().map((id) => ({
      id,
      description: outcomes.get(id) ?? null,
    }));
    info.authority = normalizeAuthority(stationing);
    info.installed = stationing.installed === true;
    return info;
  }).toSorted((a, b) => a.slug.localeCompare(b.slug));

  return {
    schema_version: "1.0",
    status: integrityStatus({ atlas, constructs }),
    component: {
      id: component.component_id,
      repository: component.repository,
      layer: component.layer,
      operator: component.operator,
      question: component.question,
      responsibility: component.responsibility,
      flow_moments: component.flow_moments,
      boundaries: component.boundaries,
    },
    territory: {
      region: region.region,
      maintainers: [...(region.maintainers ?? [])].toSorted(),
      source: region.source,
      scopes: [...(region.scopes ?? [])].toSorted(),
      outcomes: [...(region.outcomes ?? [])].toSorted((a, b) => a.id.localeCompare(b.id)),
      ratification_status: atlas.ratification_status ?? "unknown",
      ratification: atlas.ratification ?? "unknown",
      vantage: atlas.vantage ?? "unknown",
      partial: atlas.partial === true,
      conflicts: atlas.conflicts ?? [],
    },
    constructs,
    execution_contract: executionContract,
    invariants: [
      "orientation is prose and grants no authority",
      "mechanics are producer-declared and carry provenance",
      "territory is a ceiling; unknown earned authority collapses to observe",
      "mutation verbs are visually and structurally separate from read verbs",
    ],
  };
}

function skillLine(skill) {
  const caps = skill.capabilities;
  if (!caps) return `- \`${skill.slug}\` — metadata ${skill.metadata_status}`;
  return `- \`${skill.slug}\` — ${caps.model_tier ?? "model?"} · ${caps.danger_level ?? "danger?"} · ${caps.effort_hint ?? "effort?"} · ${caps.execution_hint ?? "execution?"}`;
}

export function renderConstructOperatorSurface(surface) {
  const flows = surface.component.flow_moments
    .map((flow) => `- **${flow.flow_moment_id}** (${flow.role}): ${flow.contribution}`)
    .join("\n");
  const constructs = surface.constructs.map((construct) => {
    const orientation = construct.orientation.available
      ? construct.orientation.description
      : `Unavailable: ${construct.orientation.reason}`;
    const mechanics = construct.mechanics.available
      ? (construct.mechanics.skills.length > 0 ? construct.mechanics.skills.map(skillLine).join("\n") : "- No skills declared")
      : `- Unavailable: ${construct.mechanics.reason}`;
    return `### ${construct.slug}\n\n**Orientation — prose, no authority**\n\n${orientation}\n\n**Mechanical declaration — callable surface, no authority**\n\n${mechanics}\n\n**Authority — territory + earned evidence**\n\nCeiling: **${construct.authority.ceiling}** · Earned: **${construct.authority.earned}** · Effective: **${construct.authority.effective}**\n\nAnswers for: ${construct.answers_for.map((outcome) => outcome.id).join(", ")}`;
  }).join("\n\n");
  const reads = surface.execution_contract.read_verbs.map((verb) => `\`${verb.name}\``).join(", ");
  const mutations = surface.execution_contract.mutation_verbs.map((verb) => `\`${verb.name}\``).join(", ");

  return `# ${surface.component.id} construct operator surface\n\n**Status:** ${surface.status}\n\n## User-flow responsibility\n\n${surface.component.operator.role}: ${surface.component.operator.job}\n\n${surface.component.question}\n\n${surface.component.responsibility}\n\n### Flow moments\n\n${flows}\n\n## Region-owned expertise\n\nRegion: **${surface.territory.region}** · Vantage: **${surface.territory.vantage}**\n\n${constructs}\n\n## Constructs execution contract\n\nDeterminism: **${surface.execution_contract.determinism?.class ?? "unknown"}**\n\nInfo schema: **${surface.execution_contract.info_contract?.schema_path ?? "unavailable"}**\n\nAtlas ratification gate: **${surface.territory.ratification_status}**\n\nRead verbs: ${reads || "none"}\n\nMutation verbs: ${mutations || "none"}\n\nMutation verbs are listed separately; this receipt invokes read verbs only.\n`;
}

function runConstructs(cli, args, cwd) {
  const script = /\.(?:mjs|cjs|js)$/.test(cli);
  const command = script ? process.execPath : cli;
  const commandArgs = script ? [cli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`constructs ${args[0]} returned non-JSON output (exit ${result.status ?? 1}): ${result.stderr.trim()}`);
  }
  if (![0, 5].includes(result.status ?? 1)) {
    const error = new Error(`constructs ${args[0]} failed with exit ${result.status}: ${result.stderr.trim()}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function captureLiveSnapshot({ cli, cwd = ROOT, regionId }) {
  const capabilities = runConstructs(cli, ["capabilities", "--json"], cwd);
  const atlas = runConstructs(cli, ["atlas", "--json"], cwd);
  const region = (atlas.regions ?? []).find((candidate) => candidate.region === regionId);
  if (!region) throw new Error(`construct atlas has no region named ${regionId}`);
  const info = {};
  for (const row of region.loadout ?? []) {
    try {
      info[row.construct] = runConstructs(cli, ["info", row.construct, "--json", "--rung", "local"], cwd);
    } catch (error) {
      info[row.construct] = { error: { message: error.message } };
    }
  }
  return { snapshot_version: "1.0", atlas, capabilities, info };
}

function usage() {
  return `Usage:
  node tools/construct-operator.mjs render [--system <file>] [--region <id>] (--snapshot <file> | --constructs-cli <path>) [--json]

Live mode runs read-only Constructs verbs only: capabilities, atlas, and info --rung local.`;
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args) {
  if (args[0] !== "render") {
    console.error(usage());
    return 1;
  }
  const systemPath = flagValue(args, "--system") ?? DEFAULT_SYSTEM;
  const component = readJson(systemPath);
  const regionId = flagValue(args, "--region") ?? component.component_id;
  const snapshotPath = flagValue(args, "--snapshot");
  const cli = flagValue(args, "--constructs-cli") ?? process.env.CONSTRUCTS_CLI;
  if ((snapshotPath && cli) || (!snapshotPath && !cli)) {
    console.error("construct-operator: choose exactly one of --snapshot or --constructs-cli");
    console.error(usage());
    return 1;
  }
  const snapshot = snapshotPath
    ? readJson(snapshotPath)
    : captureLiveSnapshot({ cli, cwd: ROOT, regionId });
  const surface = buildConstructOperatorSurface({ component, snapshot, regionId });
  if (args.includes("--json")) process.stdout.write(`${JSON.stringify(surface, null, 2)}\n`);
  else process.stdout.write(renderConstructOperatorSurface(surface));
  return surface.status === "drift" ? 5 : 0;
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`construct-operator: ${error.message}`);
      process.exitCode = 1;
    });
}
