/**
 * Divergence — incumbent roles vs Freeside-computed roles (SDD §5.4).
 *
 *   match            — role sets equal
 *   freeside_higher  — Freeside would grant a higher-ranked role than incumbent
 *   incumbent_higher — incumbent grants a higher-ranked role than Freeside would
 *   mismatch         — sets differ without a rank-only explanation
 */

import type { ShadowSubject } from './subject.js';
import type { ShadowEdge } from './edge.js';

export type DivergenceKind = 'match' | 'freeside_higher' | 'incumbent_higher' | 'mismatch';

export interface ShadowDivergence {
  divergence_id: string;
  community_id: string;
  subject_id: string;
  kind: DivergenceKind;
  incumbent_roles: string[];
  freeside_roles: string[];
  reason: string;
  observed_at: string;
}

export interface MemberGraphProjection {
  community_id: string;
  subjects: ShadowSubject[];
  edges: ShadowEdge[];
  divergences: ShadowDivergence[];
  summary: {
    total_subjects: number;
    identity_users: number;
    discord_members: number;
    wallet_only: number;
    unresolved: number;
    divergences: number;
  };
}
