/**
 * Shared types for gaib-cli.
 */

export type OutputFormat = 'dotenv' | 'json' | 'raw';
export type Environment = 'staging' | 'prod';

/**
 * Exit codes per SDD §9.3.
 */
export const ExitCodes = {
  SUCCESS: 0,
  UNAUTHORIZED: 1,
  MISSING_WORLD: 2,
  SCHEMA_VIOLATION: 3,
  RETRYABLE_NETWORK: 4,
  BAD_INVOCATION: 5,
} as const;

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

/**
 * A secret entry as it appears in `freeside-worlds/registry/worlds/{slug}.yaml`
 * `secrets:` array. Trimmed to the fields gaib-cli consumes.
 */
export interface RegistrySecret {
  /** Identifier within the world's registry (e.g. "database_url") */
  key: string;
  /** Env var name applications read (e.g. "DATABASE_URL") */
  env_var: string;
  /** Lifecycle hint — runtime vs. build-time. Default: runtime. */
  lifecycle?: 'runtime' | 'build';
  /** Optional human description from the registry */
  description?: string;
}

/**
 * The full registry shape we care about. Other fields exist (hosting,
 * env_vars, identity, etc.) — gaib-cli ignores them.
 */
export interface RegistryWorld {
  slug: string;
  name: string;
  repo: string;
  secrets?: RegistrySecret[];
}

/**
 * In-memory representation of a pulled secret.
 *
 * IMPORTANT: never log `value` directly per SDD §9.5. Logging surfaces use
 * `RegistrySecret` (key + env_var only) or counts.
 */
export interface PulledSecret {
  registryKey: string;     // matches RegistrySecret.key
  envVar: string;          // matches RegistrySecret.env_var
  value: string;           // load-bearing — never print except on stdout
  arn: string;             // AWS Secrets Manager ARN
}

/**
 * Result of resolving a slug to its registry world. Discriminated so callers
 * can distinguish missing-from-registry from filesystem errors.
 */
export type ResolveWorldResult =
  | { variant: 'found'; world: RegistryWorld; sourcePath: string }
  | { variant: 'missing'; slug: string; searchedPath: string }
  | { variant: 'error'; reason: string };
