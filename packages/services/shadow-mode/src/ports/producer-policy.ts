/**
 * IProducerPolicy — the ingest trust boundary (SDD §8, NFR-1..3).
 *
 * HONESTY (flatline sprint SKP-001, sev 920): the envelope `source` is
 * SELF-ASSERTED. The static policy is therefore a STRUCTURAL gate (rejects
 * malformed source×name×community combos) — NOT a real trust boundary until
 * producer AUTHENTICATION (svc-JWT) binds `source` to a verified caller. The
 * `producer` field carries that authenticated identity once wired.
 */

import type { EventName, SourceKind } from '@freeside/shadow-mode-protocol';
import type { AppendGrant } from '../auth/append-grant.js';

/** Authenticated producer identity (populated by SvcJwtPolicy; absent in the static MVP). */
export interface ProducerIdentity {
  /** The verified service subject from the svc-JWT (e.g. "identity-api"). */
  service: string;
  /** Communities this producer is authorized to write to (undefined = unrestricted in test). */
  communities?: string[];
}

export interface PolicyContext {
  source: SourceKind;
  name: EventName;
  communityId: string;
  producer?: ProducerIdentity;
  /** Raw bearer token from the transport (JwtProducerPolicy verifies it). */
  bearerToken?: string;
}

export type PolicyResult =
  | { ok: true; grant: AppendGrant }
  | { ok: false; reason: 'unauthorized_source' | 'cross_community' | 'unknown_event' | 'token_rejected' | 'no_token' };

export interface IProducerPolicy {
  verifyProducer(ctx: PolicyContext): PolicyResult | Promise<PolicyResult>;
}
