/**
 * Scope Validation Metrics
 *
 * Sprint 121: Scope Validation
 *
 * Metrics for tracking scope validation and privilege escalation attempts.
 * Alert: Critical alert on any violation.
 *
 * @see grimoires/loa/sprint.md Sprint 121 Tasks 121.4, 121.5
 */

// =============================================================================
// Metrics Storage
// =============================================================================

interface ScopeMetrics {
  /** Total scope violations (privilege escalation attempts) */
  scopeViolations: number;
  /** Scope validations by result */
  validations: Map<'allowed' | 'blocked', number>;
  /** Violations by user (for rate limiting detection) */
  violationsByUser: Map<string, number>;
}

const scopeMetrics: ScopeMetrics = {
  scopeViolations: 0,
  validations: new Map([
    ['allowed', 0],
    ['blocked', 0],
  ]),
  violationsByUser: new Map(),
};

// =============================================================================
// Recording Functions
// =============================================================================

/**
 * Record a scope violation (privilege escalation attempt).
 *
 * Alert: Critical alert on any violation.
 *
 * @param userId - Optional user ID for tracking repeat offenders
 */
export function recordScopeViolation(userId?: string): void {
  scopeMetrics.scopeViolations++;
  scopeMetrics.validations.set('blocked', (scopeMetrics.validations.get('blocked') ?? 0) + 1);

  if (userId) {
    const current = scopeMetrics.violationsByUser.get(userId) ?? 0;
    scopeMetrics.violationsByUser.set(userId, current + 1);
  }
}

/**
 * Record a successful scope validation.
 */
export function recordScopeValidationAllowed(): void {
  scopeMetrics.validations.set('allowed', (scopeMetrics.validations.get('allowed') ?? 0) + 1);
}

// =============================================================================
// Metrics Export (Prometheus Format)
// =============================================================================

/**
 * Get scope metrics in Prometheus text format.
 */
export function getScopeMetricsPrometheus(): string {
  const lines: string[] = [];

  // Scope violations counter
  // CRITICAL ALERT: Any violation should trigger alert
  lines.push('# HELP sietch_config_scope_violations_total Total privilege escalation attempts blocked');
  lines.push('# TYPE sietch_config_scope_violations_total counter');
  lines.push(`sietch_config_scope_violations_total ${scopeMetrics.scopeViolations}`);

  // Validations by result
  lines.push('# HELP sietch_config_scope_validations_total Total scope validations by result');
  lines.push('# TYPE sietch_config_scope_validations_total counter');
  for (const [result, count] of scopeMetrics.validations) {
    lines.push(`sietch_config_scope_validations_total{result="${result}"} ${count}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Get raw metrics data for testing.
 */
export function getScopeMetricsRaw(): ScopeMetrics {
  return {
    ...scopeMetrics,
    validations: new Map(scopeMetrics.validations),
    violationsByUser: new Map(scopeMetrics.violationsByUser),
  };
}

/**
 * Reset all metrics (for testing).
 */
export function resetScopeMetrics(): void {
  scopeMetrics.scopeViolations = 0;
  scopeMetrics.validations.clear();
  scopeMetrics.validations.set('allowed', 0);
  scopeMetrics.validations.set('blocked', 0);
  scopeMetrics.violationsByUser.clear();
}

/**
 * Get violation count for a specific user.
 */
export function getUserViolationCount(userId: string): number {
  return scopeMetrics.violationsByUser.get(userId) ?? 0;
}
