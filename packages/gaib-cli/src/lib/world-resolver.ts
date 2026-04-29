/**
 * Resolve a world slug to its registry YAML and parsed shape.
 *
 * Per SDD §9 + L2: the registry under `freeside-worlds/packages/registry/`
 * is canonical. gaib-cli READS it; never writes back.
 */
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { RegistryWorld, ResolveWorldResult } from '../types.js';

/**
 * Default registry root. Override via env var `FREESIDE_REGISTRY_ROOT` or
 * `--registry-root` CLI flag.
 */
const DEFAULT_REGISTRY_ROOT = resolve(
  process.env.HOME ?? '',
  'Documents',
  'GitHub',
  'freeside-worlds',
  'packages',
  'registry',
  'worlds',
);

export interface ResolveWorldOptions {
  slug: string;
  registryRoot?: string;
}

export async function resolveWorld(
  opts: ResolveWorldOptions,
): Promise<ResolveWorldResult> {
  const root = opts.registryRoot ?? process.env.FREESIDE_REGISTRY_ROOT ?? DEFAULT_REGISTRY_ROOT;
  const path = join(root, `${opts.slug}.yaml`);

  try {
    await stat(path);
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
