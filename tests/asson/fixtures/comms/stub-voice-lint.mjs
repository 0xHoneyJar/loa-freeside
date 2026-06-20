#!/usr/bin/env node
// test stub for the voice linter slot (ai-stench shape: reads stdin, exit 1 on stench).
import { readFileSync } from 'node:fs';
const t = readFileSync(0, 'utf8').toLowerCase();
process.exit(/delve|realm|—/.test(t) ? 1 : 0);
