import { runAudit } from '@freeside/shadow-audit-service';
import type { AuditRequest, AuditServiceResult, AuditDeps } from '@freeside/shadow-audit-service';
import type { AuditPort } from './audit-acl.js';

/**
 * The DECLARED LOCAL audit adapter (SDD §13 B-2).
 *
 * Runs `runAudit` in-process — but as an EXPLICITLY declared local adapter, not hidden
 * agent-navigation theater: the routing event reports `source: 'config'` truthfully, and the
 * orchestrator depends only on `AuditPort`, so this is swapped for an HTTP adapter the moment
 * the audit deploys near the belts (SDD §8, the single ACL swap point).
 *
 * `AuditDeps` (the sonar / score / role clients runAudit composes) are injected at the
 * composition root — wiring concrete clients is the audit-deploy step (SDD §13 M-10). This
 * adapter is intentionally NOT on the orchestrator's test path; orchestrator tests inject a
 * fake `AuditPort`, so the heavy audit dependency graph never loads under unit test.
 */
export class DeclaredLocalAuditAdapter implements AuditPort {
  constructor(private readonly deps: AuditDeps) {}

  invoke(req: AuditRequest): Promise<AuditServiceResult> {
    return runAudit(req, this.deps);
  }
}
