/**
 * API Routes Module
 *
 * Central barrel export for all route modules.
 * Refactored in Sprint 54 to use modular route structure.
 *
 * @module api/routes
 */

// =============================================================================
// Re-export all routers from modular structure (Sprint 54 Refactor)
// =============================================================================
export {
  // Combined router
  apiRouter,
  // Individual domain routers
  publicRouter,
  adminRouter,
  memberRouter,
  naibRouter,
  thresholdRouter,
  notificationRouter,
} from './routes/index.js';

// =============================================================================
// Re-export existing separate route files for backward compatibility
// =============================================================================
export { billingRouter } from './billing.routes.js';
export { cryptoBillingRouter } from './crypto-billing.routes.js';
export { badgeRouter } from './badge.routes.js';
export { boostRouter } from './boost.routes.js';

// =============================================================================
// Verification Routes (Sprint 79 - Native Wallet Verification)
// =============================================================================
export { createVerifyRouter, createVerifyIntegration } from './routes/index.js';
export type { VerifyRouter, VerificationIntegrationDeps, VerifyIntegration } from './routes/index.js';

// =============================================================================
// Simulation Routes (Sprint 110 - QA Sandbox Testing)
// =============================================================================
export { createSimulationRouter } from './routes/index.js';
export type { SimulationRouterDeps } from './routes/index.js';
