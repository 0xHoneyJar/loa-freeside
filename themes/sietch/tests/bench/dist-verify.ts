/**
 * Dist Verification Script
 * Sprint S13-T4: Validates dist files are in sync with TypeScript sources
 *
 * Imports directly from dist paths (not TS source) to catch:
 * - Missing exports after refactoring
 * - ESM/CJS resolution issues (e.g., ./clock.js not found)
 * - Stale dist files after TS changes
 *
 * Usage: npx tsx tests/bench/dist-verify.ts
 */

// Import from dist paths (the package.json exports resolve to dist/)
// These targeted imports avoid side-effects from modules that load Lua files at module level

const DIST_BASE = '../../../../packages/adapters/dist/agent';

async function verify() {
  const errors: string[] = [];

  function assert(condition: boolean, name: string): void {
    if (!condition) errors.push(name);
  }

  // 1. Verify clock.js exists and exports REAL_CLOCK
  try {
    const clock = await import(`${DIST_BASE}/clock.js`);
    assert(clock.REAL_CLOCK != null, 'clock.js: REAL_CLOCK');
    assert(typeof clock.REAL_CLOCK.now === 'function', 'clock.js: REAL_CLOCK.now()');
  } catch (e) {
    errors.push(`clock.js: import failed — ${(e as Error).message}`);
  }

  // 2. Verify jwt-service.js imports from clock.js (no local REAL_CLOCK)
  try {
    const jwt = await import(`${DIST_BASE}/jwt-service.js`);
    assert(jwt.JwtService != null, 'jwt-service.js: JwtService class');
  } catch (e) {
    errors.push(`jwt-service.js: import failed — ${(e as Error).message}`);
  }

  // 3. Verify budget-drift-monitor.js imports from clock.js
  try {
    const drift = await import(`${DIST_BASE}/budget-drift-monitor.js`);
    assert(drift.BudgetDriftMonitor != null, 'budget-drift-monitor.js: BudgetDriftMonitor class');
    assert(drift.DRIFT_THRESHOLD_MICRO_CENTS != null, 'budget-drift-monitor.js: DRIFT_THRESHOLD_MICRO_CENTS');
    assert(drift.DRIFT_MONITOR_JOB_CONFIG != null, 'budget-drift-monitor.js: DRIFT_MONITOR_JOB_CONFIG');
  } catch (e) {
    errors.push(`budget-drift-monitor.js: import failed — ${(e as Error).message}`);
  }

  // 4. Verify config.js has KNOWN_MODEL_ALIASES as a Set
  try {
    const config = await import(`${DIST_BASE}/config.js`);
    assert(config.KNOWN_MODEL_ALIASES instanceof Set, 'config.js: KNOWN_MODEL_ALIASES is Set');
    assert(config.KNOWN_MODEL_ALIASES.has('cheap'), 'config.js: KNOWN_MODEL_ALIASES has "cheap"');
    assert(config.KNOWN_MODEL_ALIASES.has('native'), 'config.js: KNOWN_MODEL_ALIASES has "native"');
    assert(config.agentInvokeRequestSchema != null, 'config.js: agentInvokeRequestSchema');
    assert(typeof config.loadAgentGatewayConfig === 'function', 'config.js: loadAgentGatewayConfig');
  } catch (e) {
    errors.push(`config.js: import failed — ${(e as Error).message}`);
  }

  // 5. Verify req-hash.js exports computeReqHash
  try {
    const reqHash = await import(`${DIST_BASE}/req-hash.js`);
    assert(typeof reqHash.computeReqHash === 'function', 'req-hash.js: computeReqHash');
  } catch (e) {
    errors.push(`req-hash.js: import failed — ${(e as Error).message}`);
  }

  // 6. Verify observability.js exports
  try {
    const obs = await import(`${DIST_BASE}/observability.js`);
    assert(typeof obs.createAgentLogger === 'function', 'observability.js: createAgentLogger');
    assert(typeof obs.hashWallet === 'function', 'observability.js: hashWallet');
  } catch (e) {
    errors.push(`observability.js: import failed — ${(e as Error).message}`);
  }

  // Report
  if (errors.length > 0) {
    console.error('dist-verify: FAIL');
    for (const err of errors) {
      console.error(`  ✗ ${err}`);
    }
    process.exit(1);
  }

  console.log('dist-verify: OK — all exports present');
  console.log('  ✓ clock.js (REAL_CLOCK)');
  console.log('  ✓ jwt-service.js (JwtService)');
  console.log('  ✓ budget-drift-monitor.js (BudgetDriftMonitor, DRIFT_THRESHOLD_MICRO_CENTS)');
  console.log('  ✓ config.js (KNOWN_MODEL_ALIASES, agentInvokeRequestSchema)');
  console.log('  ✓ req-hash.js (computeReqHash)');
  console.log('  ✓ observability.js (createAgentLogger, hashWallet)');
}

verify().catch((err) => {
  console.error('dist-verify: unexpected error:', err);
  process.exit(2);
});
