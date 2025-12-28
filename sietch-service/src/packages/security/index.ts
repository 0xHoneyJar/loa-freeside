/**
 * Security Package - Kill Switch & MFA
 *
 * Sprint 47: Kill Switch & MFA for Arrakis SaaS
 *
 * @module packages/security
 */

// Types
export * from './types.js';

// MFA Service
export { MFAService, MFAError } from './MFAService.js';
export type { MFAServiceConfig } from './MFAService.js';

// Kill Switch Protocol
export { KillSwitchProtocol, KillSwitchError } from './KillSwitchProtocol.js';
export type { KillSwitchProtocolConfig } from './KillSwitchProtocol.js';

// Security Guard
export { NaibSecurityGuard, SecurityGuardError, DEFAULT_PROTECTED_OPERATIONS } from './NaibSecurityGuard.js';
