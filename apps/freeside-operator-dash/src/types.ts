/**
 * Shared types for the freeside operator-dash.
 *
 * The state shape mirrors what the registry tells us, enriched with live
 * probe data + the Soju-lens discrepancy detection.
 */

export type RuntimeState = "deployed" | "scaffolded" | "not-built";

export type RegistryCell = {
  slug: string;
  git_url: string;
  beacon_url: string;
  deployment_url: string | null;
  visibility: "public" | "unlisted" | "internal";
  owner: string;
  added: string;
  runtime_state: RuntimeState;
  notes: string | null;
};

export type ProbeStateKind =
  | "up"
  | "auth-gated"
  | "degraded"
  | "scaffold"
  | "down"
  | "unreachable";

export type CellProbe = {
  slug: string;
  url: string | null; // null when no deployment_url
  state: ProbeStateKind;
  statusCode: number | null;
  latencyMs: number | null;
  bodyExcerpt: string | null;
  error: string | null;
  note: string | null;
  probedPath: string; // which path was probed (varies per cell — gateway-mismatch-aware)
};

export type IdentityApiPhase = {
  phase: 1 | 2 | 3 | 4;
  name: string;
  goalIds: string[];
  goalNotes: string[];
  status: "deployed" | "scaffolded" | "not-built";
  evidence: string[];
  beadsRefs: string[];
};

export type SojuLensRow = {
  surface: string;
  field: "displayName" | "primaryWallet" | "miberaDimensions" | "userId" | "honeyRoadSource" | "degraded";
  observed: string | null;
  source: string;
  error: string | null;
};

export type SojuLens = {
  wallet: string | null;
  rows: SojuLensRow[];
  discrepancies: string[]; // human-readable findings
};

export type DashState = {
  generatedAt: string;
  generatorVersion: string;
  cells: RegistryCell[];
  probes: CellProbe[];
  identityPhases: IdentityApiPhase[];
  sojuLens: SojuLens;
  /** Cluster events-trace snapshot (cluster-events-pillar-v1 Sprint 3). */
  eventsTrace: import("./events-trace-types.js").EventsTraceSnapshot;
  warnings: string[];
};
