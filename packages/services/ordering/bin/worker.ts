/**
 * Kitchen re-probe worker — scans producing orders on an interval.
 */
import { createOrderingComposition } from '../src/composition.js';
import { ReProbeWorker } from '../src/reprobe-worker.js';

const { store, orchestrator } = await createOrderingComposition();
const worker = new ReProbeWorker(store, orchestrator);
worker.start();

// eslint-disable-next-line no-console
console.log(`ordering-service worker started (interval ${process.env.KITCHEN_REPROBE_INTERVAL_SEC ?? 900}s)`);

process.on('SIGTERM', () => worker.stop());
process.on('SIGINT', () => worker.stop());
