/**
 * Arrakis Dynamic Contract — Reputation-gated capability resolution (cycle-043)
 *
 * Loads and validates a DynamicContract at startup, then resolves
 * ProtocolSurface per reputation state at request time.
 *
 * SDD ref: §3.4.2 (DynamicContract Validation), §3.4.6 (Reputation State Resolution)
 * Sprint: 359, Task 2.1 (FR-4)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Static } from '@sinclair/typebox';
import {
  DynamicContractSchema,
  verifyMonotonicExpansion,
} from '@0xhoneyjar/loa-hounfour/commons';
import { Value } from '@sinclair/typebox/value';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReputationStateName = 'cold' | 'warming' | 'established' | 'authoritative';

export type DynamicContract = Static<typeof DynamicContractSchema>;

export interface ProtocolSurface {
  schemas: string[];
  capabilities: string[];
  rate_limit_tier: string;
  ensemble_strategies?: string[];
}

export type DynamicContractFailure =
  | 'FILE_NOT_FOUND'
  | 'FILE_READ_ERROR'
  | 'JSON_PARSE_ERROR'
  | 'SCHEMA_VALIDATION_ERROR'
  | 'MONOTONIC_EXPANSION_VIOLATION'
  | 'OVERRIDE_SIZE_EXCEEDED';

export class DynamicContractError extends Error {
  constructor(
    public readonly failure: DynamicContractFailure,
    message: string,
    public readonly details?: unknown,
  ) {
    super(`DynamicContract[${failure}]: ${message}`);
    this.name = 'DynamicContractError';
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const OVERRIDE_MAX_SIZE_BYTES = 64 * 1024; // 64KB

// Resolved relative to this module's location, not process.cwd() (which varies by
// execution context: test runner, worker threads, serverless functions).
const DEFAULT_CONTRACT_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..', '..', '..', '..', '..',
  'config',
  'dynamic-contract.json',
);

/**
 * Guard: block env-var overrides in production unless explicitly allowed.
 * Reusable for DYNAMIC_CONTRACT_OVERRIDE and DYNAMIC_CONTRACT_PATH.
 */
function assertNotProdOverride(envVarName: string): void {
  const allowFlag = `ALLOW_${envVarName}`;
  if (process.env.NODE_ENV === 'production' && process.env[allowFlag] !== 'true') {
    throw new DynamicContractError(
      'FILE_READ_ERROR',
      `${envVarName} is blocked in production. Set ${allowFlag}=true in deployment manifest to allow.`,
    );
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _loadedContract: DynamicContract | null = null;

// ─── Load & Validate ─────────────────────────────────────────────────────────

/**
 * Load and validate a DynamicContract from disk or environment override.
 *
 * Startup validation with 6 failure modes — all produce FATAL structured log.
 * Called once at process startup; result cached as singleton.
 *
 * Override: DYNAMIC_CONTRACT_OVERRIDE env var (blocked in production).
 */
export function loadDynamicContract(
  contractPath?: string,
  options?: { logger?: { fatal: (obj: object, msg: string) => void } },
): DynamicContract {
  if (_loadedContract) return _loadedContract;

  const log = options?.logger ?? {
    fatal: (obj: object, msg: string) => console.error(msg, obj),
  };

  let raw: string;

  // Check for JSON override via env var
  const overrideJson = process.env.DYNAMIC_CONTRACT_OVERRIDE;
  if (overrideJson) {
    // Block override in production unless explicitly allowed
    try {
      assertNotProdOverride('DYNAMIC_CONTRACT_OVERRIDE');
    } catch (err) {
      log.fatal({ failure: (err as DynamicContractError).failure }, (err as Error).message);
      throw err;
    }

    // Enforce size limit
    if (Buffer.byteLength(overrideJson, 'utf8') > OVERRIDE_MAX_SIZE_BYTES) {
      const err = new DynamicContractError(
        'OVERRIDE_SIZE_EXCEEDED',
        `Override exceeds ${OVERRIDE_MAX_SIZE_BYTES} bytes limit`,
      );
      log.fatal({ failure: err.failure }, err.message);
      throw err;
    }

    raw = overrideJson;
  } else {
    // Resolution priority: explicit param > DYNAMIC_CONTRACT_PATH env > import.meta.url-relative
    let filePath: string;
    if (contractPath) {
      filePath = contractPath;
    } else if (process.env.DYNAMIC_CONTRACT_PATH) {
      try {
        assertNotProdOverride('DYNAMIC_CONTRACT_PATH');
      } catch (err) {
        log.fatal({ failure: (err as DynamicContractError).failure }, (err as Error).message);
        throw err;
      }
      filePath = process.env.DYNAMIC_CONTRACT_PATH;
    } else {
      filePath = DEFAULT_CONTRACT_PATH;
    }
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (e) {
      const isNotFound = (e as NodeJS.ErrnoException).code === 'ENOENT';
      const failure: DynamicContractFailure = isNotFound ? 'FILE_NOT_FOUND' : 'FILE_READ_ERROR';
      const err = new DynamicContractError(failure, `Cannot read ${filePath}: ${(e as Error).message}`);
      log.fatal({ failure, path: filePath }, err.message);
      throw err;
    }
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err = new DynamicContractError(
      'JSON_PARSE_ERROR',
      `Invalid JSON: ${(e as Error).message}`,
    );
    log.fatal({ failure: err.failure }, err.message);
    throw err;
  }

  // Validate against schema
  if (!Value.Check(DynamicContractSchema, parsed)) {
    const errors = [...Value.Errors(DynamicContractSchema, parsed)];
    const err = new DynamicContractError(
      'SCHEMA_VALIDATION_ERROR',
      `Contract failed schema validation: ${errors.length} error(s)`,
      errors.map((e) => ({ path: e.path, message: e.message })),
    );
    log.fatal({ failure: err.failure, errors: err.details }, err.message);
    throw err;
  }

  const contract = parsed;

  // Verify monotonic expansion
  const expansion = verifyMonotonicExpansion(contract);
  if (!expansion.valid) {
    const err = new DynamicContractError(
      'MONOTONIC_EXPANSION_VIOLATION',
      `Contract violates monotonic expansion: ${expansion.violations.length} violation(s)`,
      expansion.violations,
    );
    log.fatal({ failure: err.failure, violations: err.details }, err.message);
    throw err;
  }

  _loadedContract = contract;
  return contract;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetDynamicContract(): void {
  _loadedContract = null;
}

// ─── Surface Resolution ──────────────────────────────────────────────────────

/**
 * Resolve the ProtocolSurface for a given reputation state.
 *
 * Reputation state resolution (SKP-006):
 * - Service is authoritative, JWT is cache hint
 * - Fail-closed to 'cold' surface on any resolution failure
 */
export function resolveProtocolSurface(
  contract: DynamicContract,
  reputationState: ReputationStateName,
): ProtocolSurface {
  const surfaces = contract.surfaces as Record<string, ProtocolSurface>;
  const surface = surfaces[reputationState];
  if (!surface) {
    // Unknown state → fail-closed to cold
    return surfaces['cold'];
  }
  return surface;
}

/**
 * Check if a capability is granted by a ProtocolSurface.
 */
export function isCapabilityGranted(
  surface: ProtocolSurface,
  capability: string,
): boolean {
  return surface.capabilities.includes(capability);
}

// ─── CI/CD Validation ────────────────────────────────────────────────────────

/**
 * Validate a contract file for CI/CD pre-deploy gate.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateContractFile(
  contractPath: string,
): { valid: true } | { valid: false; error: string } {
  try {
    const saved = _loadedContract;
    _loadedContract = null;
    try {
      loadDynamicContract(contractPath);
      return { valid: true };
    } finally {
      _loadedContract = saved;
    }
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}
