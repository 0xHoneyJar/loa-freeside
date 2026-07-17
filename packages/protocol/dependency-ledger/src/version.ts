export const DEPENDENCY_LEDGER_SCHEMA_MAJOR = 1 as const;
export const DEPENDENCY_LEDGER_SCHEMA_MINOR = 0 as const;

export const DEPENDENCY_EDGE_CONTRACT = {
  name: "collection-report.dependency-edge",
  major_version: 1,
  minor_version: 0,
} as const;

export const DEPENDENCY_EDGE_CAPABILITY = "collection-report.dependency-edge.v1" as const;

/** Repair deadline before unresolved gaps escalate (SDD reconciliation objective). */
export const DEFAULT_EDGE_REPAIR_DEADLINE_MS = 5 * 60 * 1000;

/** Mixed-minor acceptance window for dependency-edge bodies. */
export const DEPENDENCY_EDGE_SUPPORTED_MINOR = 0 as const;
