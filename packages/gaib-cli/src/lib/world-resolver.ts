/**
 * Resolve a world slug to its registry YAML and parsed shape.
 *
 * Per SDD §9 + L2: the registry under `freeside-worlds/packages/registry/`
 * is canonical. gaib-cli READS it; never writes back.
 */
import { stat as fsStat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { RegistryWorld, ResolveWorldResult } from '../types.js';

/**
 * Resolution order for the registry root (Bridgebuilder F009 — fixes
 * windows / CI / non-author setups where the prior HOME-based hardcoded
 * path was unreachable):
 *
 *   1. opts.registryRoot               (explicit CLI flag)
 *   2. $FREESIDE_REGISTRY_ROOT          (env var, recommended for CI)
 *   3. ./packages/registry/worlds       (running inside freeside-worlds repo)
 *   4. ../freeside-worlds/...           (running inside a sibling repo)
 *   5. ~/Documents/GitHub/freeside-worlds/...   (legacy author default)
 *
 * Paths are checked existence-wise; the first one that exists wins.
 * If none exist the call returns `variant: missing` with the searched path.
 */
const DEFAULT_REGISTRY_CANDIDATES: string[] = [
  resolve(process.cwd(), 'packages', 'registry', 'worlds'),
  resolve(process.cwd(), '..', 'freeside-worlds', 'packages', 'registry', 'worlds'),
  resolve(homedir(), 'Documents', 'GitHub', 'freeside-worlds', 'packages', 'registry', 'worlds'),
];

async function resolveDefaultRegistryRoot(): Promise<string> {
  for (const candidate of DEFAULT_REGISTRY_CANDIDATES) {
    try {
      const s = await fsStat(candidate);
      if (s.isDirectory()) return candidate;
    } catch {
      // try next candidate
    }
  }
  // Fall through to the legacy default for the error message to surface a
  // sensible "tried this path" hint.
  return DEFAULT_REGISTRY_CANDIDATES[DEFAULT_REGISTRY_CANDIDATES.length - 1] ?? process.cwd();
}

export interface ResolveWorldOptions {
  slug: string;
  registryRoot?: string;
}

export async function resolveWorld(
  opts: ResolveWorldOptions,
): Promise<ResolveWorldResult> {
  const root =
    opts.registryRoot ??
    process.env.FREESIDE_REGISTRY_ROOT ??
    (await resolveDefaultRegistryRoot());
  const path = join(root, `${opts.slug}.yaml`);

  try {
    await fsStat(path);
  } catch {
    return { variant: 'missing', slug: opts.slug, searchedPath: path };
  }

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    return {
      variant: 'error',
      reason: `failed to read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    return {
      variant: 'error',
      reason: `failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!isRegistryWorld(parsed)) {
    return {
      variant: 'error',
      reason: `${path} does not match expected registry shape (slug, repo, optional secrets[])`,
    };
  }

  return { variant: 'found', world: parsed, sourcePath: path };
}

/**
 * Light type-guard against the registry shape. We don't ajv-validate here —
 * that's the registry's own validate.ts pipeline. We only check the fields
 * gaib-cli consumes are present + correctly typed.
 */
function isRegistryWorld(value: unknown): value is RegistryWorld {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.slug !== 'string') return false;
  if (typeof v.repo !== 'string') return false;
  if (typeof v.name !== 'string') return false;

  if (v.secrets !== undefined) {
    if (!Array.isArray(v.secrets)) return false;
    for (const s of v.secrets) {
      if (typeof s !== 'object' || s === null) return false;
      const sec = s as Record<string, unknown>;
      if (typeof sec.key !== 'string') return false;
      if (typeof sec.env_var !== 'string') return false;
    }
  }

  return true;
}

/**
 * Derive the AWS Secrets Manager secret ID for a given world + env. Mirrors
 * the existing loa-freeside convention (per `scripts/load-honeyroad-secrets.sh`
 * and friends): the secret ID is the world slug suffixed by env when staging.
 *
 * - prod:    `arrakis-production-{slug}`
 * - staging: `arrakis-staging-{slug}`
 *
 * Values for individual env-vars live as JSON keys WITHIN the per-world
 * secret (one Secrets Manager secret per world, holding a JSON map of all
 * env-vars). This mirrors the `load-honeyroad-secrets.sh` pattern.
 */
export function deriveSecretId(slug: string, env: 'staging' | 'prod'): string {
  const prefix = env === 'prod' ? 'arrakis-production' : 'arrakis-staging';
  return `${prefix}-${slug}`;
}
