/**
 * The append-only truth layer: observations + attributed edges (SDD §5.0).
 *
 * `ShadowObservation` is the immutable record of an accepted event (never
 * updated or deleted). `ShadowEdge` is the attributed evidence derived from an
 * observation, carrying its `truth_status` and `source`.
 */

import type { EventName } from './envelope.js';
import type { SourceKind, TruthStatus } from './common.js';

export interface ShadowObservation {
  event_id: string;
  community_id: string;
  name: EventName;
  source: SourceKind;
  truth_status: TruthStatus;
  observed_at: string;
  emitted_at: string;
  evidence_ref?: string;
  payload: unknown;
  ingested_at: string;
}

export interface ShadowEdge {
  edge_id: string;
  community_id: string;
  subject_id: string;
  source: SourceKind;
  edge_kind: string;
  truth_status: TruthStatus;
  observed_at: string;
  evidence_ref?: string;
  data: Record<string, unknown>;
}
