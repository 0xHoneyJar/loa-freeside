#!/usr/bin/env node
// test stub for the product-vocab linter slot: exit 1 if an off-brand term appears.
import { readFileSync } from 'node:fs';
const t = readFileSync(process.argv[2], 'utf8').toLowerCase();
process.exit(/\b(synergy|leverage|disrupt)\b/.test(t) ? 1 : 0);
