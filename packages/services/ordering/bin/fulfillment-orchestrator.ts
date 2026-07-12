/**
 * Fulfillment orchestrator — sibling Railway worker (SDD §4.1, D-1).
 *
 * Drives non-terminal community-onboarding orders through probe → dispatch → wait →
 * advance → (fulfill | escalate). Gated by ORCHESTRATOR_ENABLED so it never runs unless
 * explicitly deployed; env-config is reused from the intake service.
 */
import { createFulfillmentOrchestratorWorker, orchestratorEnabled } from '../src/composition.js';
import { reprobeIntervalMs } from '../src/reprobe-worker.js';

if (!orchestratorEnabled()) {
  // eslint-disable-next-line no-console
  console.log('fulfillment-orchestrator disabled (set ORCHESTRATOR_ENABLED=true to run)');
  process.exit(0);
}

const worker = await createFulfillmentOrchestratorWorker();
worker.start();

// eslint-disable-next-line no-console
console.log(`fulfillment-orchestrator started (interval ${reprobeIntervalMs() / 1000}s)`);

process.on('SIGTERM', () => worker.stop());
process.on('SIGINT', () => worker.stop());
