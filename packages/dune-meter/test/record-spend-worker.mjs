// Worker script for the concurrency test (T-2).
// Invoked via child_process.fork; reads ledgerPath and credits from env,
// calls recordSpend, then exits 0 on success or 1 on error.
import { recordSpend } from '../src/budget-ledger.mjs';

const ledgerPath = process.env.WORKER_LEDGER_PATH;
const credits = Number(process.env.WORKER_CREDITS);

recordSpend(ledgerPath, credits)
  .then(() => process.exit(0))
  .catch((e) => { process.stderr.write(e.message + '\n'); process.exit(1); });
