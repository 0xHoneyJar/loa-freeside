/**
 * Core Domain Types
 *
 * Sprint S-20: Wizard Session Store & State Model
 * Sprint S-24: Incumbent Detection & Shadow Ledger
 * Sprint S-25: Shadow Sync Job & Verification Tiers
 * Sprint S-26: Namespaced Roles & Parallel Channels
 * Sprint S-27: Glimpse Mode & Migration Readiness
 * Sprint S-28: Migration Strategies & Rollback
 *
 * Exports all domain types and models for the application.
 * Domain types represent core business concepts independent of infrastructure.
 */

// Wizard Domain Types
export * from './wizard.js';

// Coexistence Domain Types (Sprint S-24)
export * from './coexistence.js';

// Verification Tiers Domain Types (Sprint S-25)
export * from './verification-tiers.js';

// Parallel Mode Domain Types (Sprint S-26)
export * from './parallel-mode.js';

// Glimpse Mode Domain Types (Sprint S-27)
export * from './glimpse-mode.js';

// Migration Domain Types (Sprint S-28)
export * from './migration.js';
