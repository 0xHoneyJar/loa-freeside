#!/usr/bin/env node
// Non-deterministic fixture for the B7 harvest guard: two runs differ.
process.stdout.write(String(process.hrtime.bigint()) + "\n");
