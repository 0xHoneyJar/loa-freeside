/**
 * Arrakis Compatibility & Boundary Normalization Module
 *
 * Handles protocol version negotiation and boundary normalization:
 * - Version negotiation (advertise v8.2.0 preferred, dual-accept v7.11.0)
 * - Inbound claim normalization (trust_level → trust_scopes mapping)
 * - Coordination message normalization (reject missing version discriminator)
 * - Feature flag for quick disable without code rollback
 *
 * Phase A (Cycle 043): Dual-accept v7.11.0 and v8.2.0 (both supported)
 * Phase B: loa-finn upgrades to v8.2.0 (tracked via GitHub issue)
 * Phase C: Tighten to >=8.2.0 only when ALL transition criteria met:
 *   1. Telemetry confirms 0 v7.11.0 consumers for 7 consecutive days
 *   2. loa-finn upgraded to v8.2.0 (prerequisite: loa-dixie emits ModelPerformanceEvent)
 *   3. All internal services confirmed v8.2.0 compatible
 *   4. 14-day deprecation notice period completed
 *   5. Straggler handling: any remaining v7.11.0 peers get 400 with migration guide
 *
 * Task: 300.5 (Sprint 300, cycle-034), updated cycle-043
 * SDD ref: §3.6, §3.7, §8.3
 */

import {
  validateCompatibility,
  CONTRACT_VERSION,
  type CapabilityScope,
  type CapabilityScopedTrust,
  type TrustLevel as CanonicalTrustLevel,
  flatTrustToScoped,
} from '@0xhoneyjar/loa-hounfour';

// =============================================================================
// Version Negotiation
// =============================================================================

export interface VersionNegotiation {
  preferred: string;
  supported: readonly string[];
}

/**
 * Advertise supported protocol versions.
 * Phase A (cycle-043): Prefer v8.2.0, dual-accept v7.11.0.
 * validateCompatibility() delegates entirely to hounfour — no local range logic.
 */
export function negotiateVersion(): VersionNegotiation {
  return {
    preferred: '8.2.0',
    supported: ['7.11.0', '8.2.0'] as const,
  };
}

// =============================================================================
// Feature Flag
// =============================================================================

/**
 * Check if v7.0.0 normalization is enabled.
 * Set PROTOCOL_V7_NORMALIZATION=false to disable (reverts to v4.6 behavior).
 */
export function isV7NormalizationEnabled(): boolean {
  const flag = process.env.PROTOCOL_V7_NORMALIZATION;
  if (flag === 'false' || flag === '0') return false;
  return true; // enabled by default
}

// =============================================================================
// Trust Scope Types
// =============================================================================

/**
 * Freeside fine-grained trust scopes (capability-based).
 *
 * Distinct from canonical hounfour CapabilityScope (coarse: billing, governance,
 * inference, delegation, audit, composition). Freeside scopes add read/write/admin
 * granularity per capability domain.
 *
 * Canonical CapabilityScope and CapabilityScopedTrust are re-exported from the
 * barrel for consumers that need the canonical wire format.
 */
export type TrustScope =
  | 'billing:read'
  | 'billing:write'
  | 'billing:admin'
  | 'agent:invoke'
  | 'agent:manage'
  | 'agent:admin'
  | 'governance:propose'
  | 'governance:vote'
  | 'governance:admin'
  | 'admin:full';

/** v4.6.0 trust_level (integer 0-9) */
export type TrustLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// =============================================================================
// Trust Level → Trust Scopes Mapping (Least Privilege)
// =============================================================================

/**
 * Least-privilege mapping from v4.6.0 trust_level to v7.0.0 trust_scopes.
 *
 * CRITICAL INVARIANT: trust_level can NEVER map to admin:full.
 * Even trust_level=9 maps to governance scopes, not admin.
 *
 * SDD ref: §3.6 — "trust_level=9 NEVER maps to admin:true"
 */
const TRUST_LEVEL_TO_SCOPES: Record<TrustLevel, readonly TrustScope[]> = {
  0: ['billing:read'],
  1: ['billing:read', 'agent:invoke'],
  2: ['billing:read', 'agent:invoke'],
  3: ['billing:read', 'billing:write', 'agent:invoke'],
  4: ['billing:read', 'billing:write', 'agent:invoke'],
  5: ['billing:read', 'billing:write', 'agent:invoke', 'agent:manage'],
  6: ['billing:read', 'billing:write', 'agent:invoke', 'agent:manage'],
  7: ['billing:read', 'billing:write', 'agent:invoke', 'agent:manage', 'governance:propose'],
  8: ['billing:read', 'billing:write', 'agent:invoke', 'agent:manage', 'governance:propose', 'governance:vote'],
  // Level 9 intentionally identical to level 8: admin:full ceiling cap (SDD §3.6).
  // The highest legacy trust_level still cannot escalate to admin:full.
  9: ['billing:read', 'billing:write', 'agent:invoke', 'agent:manage', 'governance:propose', 'governance:vote'],
};

/** Versions in the local transition window that bypass canonical validateCompatibility.
 * Phase A (cycle-043): v7.11.0 is the backward-compat target.
 * v4.6.0 removed from transition window — no longer supported. */
const LOCAL_TRANSITION_VERSIONS = new Set(['7.11.0']);

/** Runtime-valid trust scopes for defense-in-depth validation (F-6). */
const VALID_SCOPES = new Set<TrustScope>([
  'billing:read', 'billing:write', 'billing:admin',
  'agent:invoke', 'agent:manage', 'agent:admin',
  'governance:propose', 'governance:vote', 'governance:admin',
  'admin:full',
]);

// =============================================================================
// Inbound Claim Normalization
// =============================================================================

export interface NormalizedClaims {
  trust_scopes: readonly TrustScope[];
  source: 'v7_native' | 'v4_mapped';
}

export class ClaimNormalizationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`ClaimNormalizationError [${code}]: ${message}`);
    this.name = 'ClaimNormalizationError';
    this.code = code;
  }
}

/**
 * Normalize inbound JWT claims to v7.0.0 trust_scopes.
 *
 * Exactly-one-of enforcement:
 * - Token has trust_scopes (v7.0.0) → use directly
 * - Token has trust_level (v4.6.0) → map via least-privilege table
 * - Token has BOTH → REJECT (ambiguous authority)
 * - Token has NEITHER → REJECT (no authority)
 *
 * Post-normalization: validates output has at least one scope.
 *
 * @throws {ClaimNormalizationError} on invalid input
 */
/**
 * Claim version telemetry callback (Task 2.7).
 * Set via setClaimVersionLogger() to receive structured telemetry on every
 * JWT normalization. Default: no-op.
 *
 * Cutoff policy: v4.6.0 dual-accept will be removed after telemetry confirms
 * 0 v4.6.0 claims for 7 consecutive days (max JWT TTL = 24h + 6d buffer).
 */
type ClaimVersionLogger = (data: { claim_version: 'v7.0.0' | 'v4.6.0'; source: string }) => void;
let claimVersionLogger: ClaimVersionLogger = () => {};

/** Set the telemetry logger for claim version observations. */
export function setClaimVersionLogger(logger: ClaimVersionLogger): void {
  claimVersionLogger = logger;
}

export function normalizeInboundClaims(claims: {
  trust_level?: number;
  trust_scopes?: string[];
}): NormalizedClaims {
  if (!isV7NormalizationEnabled()) {
    // Feature flag disabled — pass through without normalization
    if (claims.trust_scopes && claims.trust_scopes.length > 0) {
      // Security invariant: always block admin:full regardless of feature flag state.
      // The privilege escalation guard is not a normalization behavior.
      if ((claims.trust_scopes).includes('admin:full')) {
        throw new ClaimNormalizationError(
          'PRIVILEGE_ESCALATION',
          'Inbound token cannot contain admin:full scope'
        );
      }
      // Runtime scope validation even when disabled (defense-in-depth)
      const unknownDisabled = (claims.trust_scopes).filter(s => !VALID_SCOPES.has(s as TrustScope));
      if (unknownDisabled.length > 0) {
        throw new ClaimNormalizationError(
          'UNKNOWN_SCOPE',
          `Unknown trust scopes: ${unknownDisabled.join(', ')}`
        );
      }
      return { trust_scopes: claims.trust_scopes as TrustScope[], source: 'v7_native' };
    }
    if (claims.trust_level !== undefined) {
      const level = claims.trust_level;
      if (!Number.isInteger(level) || level < 0 || level > 9) {
        throw new ClaimNormalizationError(
          'INVALID_TRUST_LEVEL',
          `trust_level must be integer in [0, 9], got ${level}`
        );
      }
      return { trust_scopes: ['billing:read', 'agent:invoke'] as TrustScope[], source: 'v4_mapped' };
    }
    throw new ClaimNormalizationError('NO_AUTHORITY', 'Token has neither trust_level nor trust_scopes');
  }

  const hasTrustLevel = claims.trust_level !== undefined && claims.trust_level !== null;
  const hasTrustScopes = claims.trust_scopes !== undefined && claims.trust_scopes !== null && claims.trust_scopes.length > 0;

  // Exactly-one-of enforcement
  if (hasTrustLevel && hasTrustScopes) {
    throw new ClaimNormalizationError(
      'AMBIGUOUS_AUTHORITY',
      'Token has both trust_level and trust_scopes — exactly one required'
    );
  }

  if (!hasTrustLevel && !hasTrustScopes) {
    throw new ClaimNormalizationError(
      'NO_AUTHORITY',
      'Token has neither trust_level nor trust_scopes'
    );
  }

  // v7.0.0 native: use trust_scopes directly
  if (hasTrustScopes) {
    const scopes = claims.trust_scopes as TrustScope[];
    // Post-normalization validation: no admin:full in scopes from external tokens
    // (admin:full can only be set by the system, not by inbound tokens)
    if (scopes.includes('admin:full')) {
      throw new ClaimNormalizationError(
        'PRIVILEGE_ESCALATION',
        'Inbound token cannot contain admin:full scope'
      );
    }
    // Runtime scope validation: reject unknown scopes (defense-in-depth)
    const unknownScopes = scopes.filter(s => !VALID_SCOPES.has(s));
    if (unknownScopes.length > 0) {
      throw new ClaimNormalizationError(
        'UNKNOWN_SCOPE',
        `Unknown trust scopes: ${unknownScopes.join(', ')}`
      );
    }
    claimVersionLogger({ claim_version: 'v7.0.0', source: 'normalizeInboundClaims' });
    return { trust_scopes: scopes, source: 'v7_native' };
  }

  // v4.6.0 legacy: map trust_level via least-privilege table
  const level = claims.trust_level!;

  // Range validation
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    throw new ClaimNormalizationError(
      'INVALID_TRUST_LEVEL',
      `trust_level must be integer in [0, 9], got ${level}`
    );
  }

  const scopes = TRUST_LEVEL_TO_SCOPES[level as TrustLevel];

  // Post-normalization re-validation
  if (!scopes || scopes.length === 0) {
    throw new ClaimNormalizationError(
      'MAPPING_FAILURE',
      `No scopes mapped for trust_level=${level}`
    );
  }

  claimVersionLogger({ claim_version: 'v4.6.0', source: 'normalizeInboundClaims' });
  return { trust_scopes: scopes, source: 'v4_mapped' };
}

// =============================================================================
// Coordination Message Normalization
// =============================================================================

export interface CoordinationMessage {
  version?: string;
  type: string;
  payload: unknown;
  [key: string]: unknown;
}

export interface NormalizedCoordinationMessage {
  version: string;
  type: string;
  payload: unknown;
}

/**
 * Normalize inbound coordination messages.
 *
 * - v7.0.0 messages: pass through
 * - v4.6.0 messages: normalize to v7.0.0 format
 * - Missing version discriminator: REJECT (never assume legacy)
 * - Unknown version: REJECT
 *
 * SDD ref: §3.7 — "normalizeCoordinationMessage() rejects missing version discriminator"
 *
 * @throws {ClaimNormalizationError} on invalid input
 */
export function normalizeCoordinationMessage(
  message: CoordinationMessage
): NormalizedCoordinationMessage {
  if (!isV7NormalizationEnabled()) {
    // Feature flag disabled — require version and validate against supported set
    if (!message.version) {
      throw new ClaimNormalizationError(
        'MISSING_VERSION',
        'Coordination message missing version discriminator (even with normalization disabled, version is required)'
      );
    }
    const { supported } = negotiateVersion();
    if (!supported.includes(message.version)) {
      throw new ClaimNormalizationError(
        'UNSUPPORTED_VERSION',
        `Coordination message version ${message.version} not in supported set [${supported.join(', ')}]`
      );
    }
    return { version: message.version, type: message.type, payload: message.payload };
  }

  // CRITICAL: Never assume legacy. Missing version = reject.
  if (!message.version) {
    throw new ClaimNormalizationError(
      'MISSING_VERSION',
      'Coordination message missing version discriminator — cannot assume legacy format'
    );
  }

  const negotiation = negotiateVersion();
  const supported = negotiation.supported;

  // Check if version is supported
  if (!supported.includes(message.version)) {
    throw new ClaimNormalizationError(
      'UNSUPPORTED_VERSION',
      `Coordination message version ${message.version} not in supported set [${supported.join(', ')}]`
    );
  }

  // Validate compatibility with canonical function.
  // For versions in the local transition window (v4.6.0), skip canonical validation
  // because canonical MIN_SUPPORTED_VERSION=6.0.0 rejects v4.6.0. The local
  // supported set check above already gates which versions we accept.
  if (LOCAL_TRANSITION_VERSIONS.has(message.version)) {
    return { version: message.version, type: message.type, payload: message.payload };
  }

  const compat = validateCompatibility(message.version);
  if (!compat.compatible) {
    throw new ClaimNormalizationError(
      'INCOMPATIBLE_VERSION',
      `Version ${message.version} is incompatible: ${compat.error || 'unknown reason'}`
    );
  }

  return {
    version: message.version,
    type: message.type,
    payload: message.payload,
  };
}

// =============================================================================
// Re-export canonical compatibility + identity types
// =============================================================================

export { validateCompatibility, CONTRACT_VERSION };

// Re-export canonical identity types for consumers needing wire format
export type { CapabilityScope, CapabilityScopedTrust, CanonicalTrustLevel };
export { flatTrustToScoped };
