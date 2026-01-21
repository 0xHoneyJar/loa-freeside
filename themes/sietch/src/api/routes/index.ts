/**
 * API Routes Index
 * Sprint 51: Route modularization - Central router composition and re-exports
 *
 * This module combines all route modules into a single apiRouter and
 * re-exports individual routers for backward compatibility.
 */

import { Router } from 'express';
import { publicRouter } from './public.routes.js';
import { adminRouter } from './admin.routes.js';
import { memberRouter } from './member.routes.js';
import { naibRouter } from './naib.routes.js';
import { thresholdRouter } from './threshold.routes.js';
import { notificationRouter } from './notification.routes.js';
import { billingRouter } from '../billing.routes.js';
import { badgeRouter } from '../badge.routes.js';
import { boostRouter } from '../boost.routes.js';
import { themeRouter } from './theme.routes.js';

/**
 * Combined API router that mounts all sub-routers
 */
export const apiRouter = Router();

// Mount public routes at root (no prefix)
apiRouter.use('/', publicRouter);

// Mount admin routes at /admin
apiRouter.use('/admin', adminRouter);

// Mount member routes at root (they have their own prefixes like /profile, /members, etc.)
apiRouter.use('/', memberRouter);

// Mount Naib routes at root (they have /naib prefix)
apiRouter.use('/', naibRouter);

// Mount threshold routes at root (they have /threshold and /waitlist prefixes)
apiRouter.use('/', thresholdRouter);

// Mount notification routes at root (they have /notifications and /position prefixes)
apiRouter.use('/', notificationRouter);

// Mount billing routes at /billing (v4.0 - Sprint 23)
apiRouter.use('/billing', billingRouter);

// Mount badge routes at /badges (v4.0 - Sprint 27)
apiRouter.use('/badges', badgeRouter);

// Mount boost routes at /boost (v4.0 - Sprint 28)
apiRouter.use('/boost', boostRouter);

// Mount theme builder routes at /themes (Sprint 1 - WYSIWYG Theme Builder)
apiRouter.use('/themes', themeRouter);

/**
 * Re-export individual routers for backward compatibility and direct access
 */
export {
  publicRouter,
  adminRouter,
  memberRouter,
  naibRouter,
  thresholdRouter,
  notificationRouter,
  billingRouter,
  badgeRouter,
  boostRouter,
  themeRouter,
};

/**
 * Verification routes (Sprint 79 - Native Wallet Verification)
 * These are factory functions that require dependency injection
 */
export { createVerifyRouter } from './verify.routes.js';
export { createVerifyIntegration } from './verify.integration.js';
export type { VerifyRouter } from './verify.routes.js';
export type { VerificationIntegrationDeps, VerifyIntegration } from './verify.integration.js';

/**
 * Simulation routes (Sprint 110 - QA Sandbox Testing)
 * Factory function that requires Redis dependency injection
 */
export { createSimulationRouter } from './simulation.routes.js';
export type { SimulationRouterDeps } from './simulation.routes.js';

/**
 * Dashboard routes (Sprint 114 - Web Configuration Dashboard)
 * Factory function that requires Redis and guildId dependency injection
 */
export { createDashboardRouter, createDashboardAuthRouter } from './dashboard/index.js';
export type {
  DashboardRouterDeps,
  DashboardAuthDeps,
  DashboardSession,
  DashboardAuthRequest,
} from './dashboard/index.js';

/**
 * Local authentication routes (Sprint 141 - Gom Jabbar CLI Authentication)
 * Username/password authentication for CLI and dashboard
 */
export { createAuthRouter, requireLocalAuth, requireRoles, addApiKeyVerifyRoute } from './auth.routes.js';
export type { AuthenticatedRequest } from './auth.routes.js';

/**
 * User management routes (Sprint 142 - Gom Jabbar CLI User Management)
 * Admin endpoints for managing local user accounts
 */
export { createUsersRouter } from './users.routes.js';
