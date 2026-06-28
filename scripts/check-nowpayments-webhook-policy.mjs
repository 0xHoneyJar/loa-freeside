#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const source = readFileSync('packages/routes/webhooks.routes.ts', 'utf8');
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

function occurrences(pattern) {
  return source.split(pattern).length - 1;
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
  source.includes("normalizeSingleHeader(req.headers['x-nowpayments-sig'])"),
  'NOWPayments signature header must be normalized before HMAC comparison',
);

require(
  occurrences("req.headers['x-nowpayments-sig']") === 1,
  'NOWPayments signature header must only be read once through the normalization helper',
);

require(
  source.includes('function normalizeSingleHeader(header: string | string[] | undefined)') &&
    source.includes('Array.isArray(header)') &&
    source.includes('return undefined'),
  'signature normalization must reject duplicated/array headers instead of casting them to string',
);

require(
  source.includes('const trimmed = header?.trim();') &&
    source.includes('return trimmed ? trimmed : undefined'),
  'signature normalization must reject empty or whitespace-only signature headers',
);

require(
  !source.includes("req.headers['x-nowpayments-sig'] as string"),
  'webhook handler must not cast x-nowpayments-sig directly from Express headers',
);

require(
  !source.includes("req.headers['x-nowpayments-sig'].join") &&
    !source.includes('Array.isArray(signature)') &&
    !source.includes('Array.isArray(req.headers'),
  'webhook handler must not join or select from duplicated signature headers',
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
