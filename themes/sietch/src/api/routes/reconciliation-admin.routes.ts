/**
 * Reconciliation Admin Routes
 *
 * Admin-only endpoints for manual reconciliation trigger and history queries.
 * All endpoints require admin role.
 *
 * SDD refs: §SS4.6
 * Sprint refs: Task 9.3
 *
 * @module api/routes/reconciliation-admin.routes
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { IReconciliationService } from '../../packages/core/ports/IReconciliationService.js';

export interface ReconciliationAdminRoutesDeps {
  reconciliation: IReconciliationService;
  requireRole?: (role: string) => (req: Request, res: Response, next: () => void) => void;
}

export function createReconciliationAdminRoutes(deps: ReconciliationAdminRoutesDeps): Router {
  const router = Router();

  // Apply admin role guard if provided
  if (deps.requireRole) {
    router.use(deps.requireRole('admin'));
  }

  /**
   * POST /api/admin/reconciliation/run
   * Trigger manual reconciliation. Returns full result.
   */
  router.post('/run', async (_req: Request, res: Response) => {
    try {
      const result = await deps.reconciliation.reconcile();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Reconciliation failed', message: (err as Error).message });
    }
  });

  /**
   * GET /api/admin/reconciliation/history
   * Returns recent reconciliation results.
   */
  router.get('/history', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const history = await deps.reconciliation.getHistory(limit);
      res.json({ results: history, count: history.length });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch history', message: (err as Error).message });
    }
  });

  return router;
}
