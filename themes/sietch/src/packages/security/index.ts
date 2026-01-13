/**
 * Security Package - Kill Switch, MFA, Audit Logs, API Keys & Session Security
 *
 * Sprint 47: Kill Switch & MFA for Arrakis SaaS
 * Sprint 50: Post-Audit Hardening (P0)
 * Sprint 51: Session Security Enhancements (P1)
 * Sprint 68: MFA Hardening (Duo Integration)
 *
 * @module packages/security
 */

// Types
export * from './types.js';

// MFA Module (Sprint 68)
export * from './mfa/index.js';

// MFA Service
export { MFAService, MFAError } from './MFAService.js';
export type { MFAServiceConfig } from './MFAService.js';

// Kill Switch Protocol
export { KillSwitchProtocol, KillSwitchError } from './KillSwitchProtocol.js';
export type { KillSwitchProtocolConfig } from './KillSwitchProtocol.js';

// Security Guard
export { NaibSecurityGuard, SecurityGuardError, DEFAULT_PROTECTED_OPERATIONS } from './NaibSecurityGuard.js';

// Audit Log Persistence (Sprint 50)
export { AuditLogPersistence, createAuditLogPersistence } from './AuditLogPersistence.js';
export type {
  AuditLogPersistenceConfig,
  AuditLogEntry,
  SignedAuditLogEntry,
  AuditLogQueryOptions,
  AuditLogQueryResult,
  ArchivalResult,
} from './AuditLogPersistence.js';

// API Key Manager (Sprint 50)
export { ApiKeyManager, createApiKeyManager } from './ApiKeyManager.js';
export type {
  ApiKeyManagerConfig,
  ApiKeyRecord,
  KeyRotationResult,
  KeyValidationResult,
} from './ApiKeyManager.js';

// Secure Session Store (Sprint 51)
export { SecureSessionStore, createSecureSessionStore } from './SecureSessionStore.js';
export type {
  SecureSessionStoreConfig,
  SecureSession,
  SessionSecurityContext,
  SessionValidationResult,
  RateLimitStatus,
} from './SecureSessionStore.js';
