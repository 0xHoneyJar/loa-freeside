#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const source = readFileSync('packages/routes/webhooks.routes.ts', 'utf8');
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

require(
  source.includes("typeof req.body === 'string'") && source.includes('Buffer.isBuffer(req.body)'),
  'webhook handler must accept exact raw body as string or Buffer',
);

require(
  !source.includes('JSON.stringify(sortKeys(req.body))'),
  'webhook handler must not reconstruct JSON for signature input',
);

require(
  source.includes('receipt_insert_failed') && source.includes('res.status(500)'),
  'webhook receipt insert failure must be retryable',
);

require(
  source.includes('Duplicate receipt') && source.includes('continuing idempotent processing'),
  'duplicate receipt must continue through idempotent processing',
);

require(
  source.includes('credit_lot_mint_failed') && source.includes('return;'),
  'credit lot mint failure must return a retryable response before success',
);

require(
  source.includes('stale_webhook') && source.includes('invalid_updated_at'),
  'timestamp policy must reject stale and invalid updated_at values',
);

if (failures.length > 0) {
  console.error('NOWPayments webhook policy check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('NOWPayments webhook policy check passed.');
