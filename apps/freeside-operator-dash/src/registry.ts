/**
 * Read packages/freeside-registry/registry.yaml.
 *
 * Done server-side, in-process. Repo-relative path. No browser fetch.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { RegistryCell, RuntimeState } from "./types.js";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", // src
  "..", // apps/freeside-operator-dash
  "..", // apps
  "..", // repo root
);

const REGISTRY_PATH = join(REPO_ROOT, "packages", "freeside-registry", "registry.yaml");

type RawCell = {
  git_url: string;
  beacon_url: string;
  deployment_url?: string | null;
  visibility: "public" | "unlisted" | "internal";
  owner: string;
  added: string;
  runtime_state?: RuntimeState;
  notes?: string;
};

type RawRegistry = {
  version: number;
  modules?: Record<string, RawCell>;
};

function normalize(slug: string, raw: RawCell): RegistryCell {
  return {
    slug,
    git_url: raw.git_url,
    beacon_url: raw.beacon_url,
    deployment_url: raw.deployment_url ?? null,
    visibility: raw.visibility,
    owner: raw.owner,
    added: raw.added,
    runtime_state: raw.runtime_state ?? "not-built",
    notes: raw.notes ?? null,
  };
}

export function loadRegistry(): RegistryCell[] {
  const txt = readFileSync(REGISTRY_PATH, "utf8");
  const yaml = parseYaml(txt) as RawRegistry;
  const modules = yaml.modules ?? {};
  return Object.entries(modules)
    .map(([slug, raw]) => normalize(slug, raw))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export const REGISTRY_PATH_DEBUG = REGISTRY_PATH;
