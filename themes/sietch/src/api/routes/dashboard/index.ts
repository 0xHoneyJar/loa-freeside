/**
 * Dashboard Routes Index
 *
 * Sprint 114-132: Web Configuration Dashboard
 *
 * Central router composition for dashboard API endpoints.
 */

import { Router } from 'express';
import { createDashboardAuthRouter, type DashboardAuthDeps } from './auth.routes.js';

/**
 * Dependencies for all dashboard routes
 */
export interface DashboardRouterDeps extends DashboardAuthDeps {}

/**
 * Create dashboard router with all sub-routes mounted
 */
export function createDashboardRouter(deps: DashboardRouterDeps): Router {
  const router = Router();

  // Mount auth routes at /auth
  const authRouter = createDashboardAuthRouter(deps);
  router.use('/auth', authRouter);

  // Future routes will be added here:
  // - /config - Configuration management (Sprint 118)
  // - /drift - Drift detection (Sprint 124)
  // - /restore - Restore operations (Sprint 126)
  // - /servers - Server management

  return router;
}

// Re-exports
export { createDashboardAuthRouter, type DashboardAuthDeps } from './auth.routes.js';
export type {
  DashboardSession,
  DashboardAuthRequest,
} from './auth.routes.js';
