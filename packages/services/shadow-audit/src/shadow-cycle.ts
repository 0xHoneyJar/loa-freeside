/**
 * runShadowCycle — one cron-fireable shadow run. The orchestration the operator binds to live data.
 *
 * Run the audit AUTHED → derive the per-member Comparison View (the audit-service already carries it on
 * `output.discrepancy`) → persist a ShadowSnapshot. READ-ONLY: it produces a report and appends to the
 * store; it touches no Discord role (Shadow Mode operates ALONGSIDE the incumbent). The live deps
 * (sonar/score/roles) + the cadence (cron / scheduled-cycle) + the store backend are INJECTED — the shape
 * is here; binding it to a community's live sources is the operator's one decision.
 */
import { runAudit, type AuditDeps, type AuditRequest } from './audit-service.js';
import { runShadow, type ShadowSnapshot, type ShadowStore } from '@freeside/shadow-audit-protocol';

export type ShadowCycleResult =
  | { readonly ok: true; readonly snapshot: ShadowSnapshot }
  | { readonly ok: false; readonly reason: string };

export async function runShadowCycle(
  req: AuditRequest,
  deps: AuditDeps,
  store: ShadowStore,
  computed_at: string,
): Promise<ShadowCycleResult> {
  // authed run — we need the per-member records to build the Comparison View
  const audit = await runAudit({ ...req, includeRecords: true }, deps);
  if (!audit.ok) return { ok: false, reason: audit.refusal.code };
  const records = audit.output.records ?? [];
  if (records.length === 0) return { ok: false, reason: 'no-records' };
  const snapshot = await runShadow(
    { community: req.order.community.name, mode: 'dogfood-full', computed_at, records },
    store,
  );
  return { ok: true, snapshot };
}
