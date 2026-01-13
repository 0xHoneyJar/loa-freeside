/**
 * MFA Module Exports
 *
 * Sprint 68: MFA Hardening & Observability
 *
 * @module packages/security/mfa
 */

// Duo MFA Verifier
export {
  DuoMfaVerifier,
  createDuoMfaVerifierFromEnv,
  isDuoConfigured,
} from './DuoMfaVerifier.js';

export type {
  DuoMfaVerifierConfig,
  DuoHttpClient,
  DuoApiResponse,
  DuoVerificationResult,
} from './DuoMfaVerifier.js';

// MFA Router Service
export {
  MfaRouterService,
  createMfaRouter,
  getRiskTierFromScore,
} from './MfaRouterService.js';

export type {
  RiskTier,
  MfaMethod,
  MfaRouterConfig,
  TieredMfaRequest,
  TieredMfaResult,
} from './MfaRouterService.js';
