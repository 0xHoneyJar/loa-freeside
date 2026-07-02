/**
 * Worldline coherence · score-api registry notes (loa-freeside#417 network slice)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_ROOT = join(__dirname, '..');

test('registry.yaml score-api notes document Railway prod and dormant ECS', () => {
  const yaml = readFileSync(join(REGISTRY_ROOT, 'registry.yaml'), 'utf8');
  const block = yaml.match(/score-api:[\s\S]*?(?=\n  [a-z-]+-api:|\nmodules:|\Z)/);
  assert.ok(block, 'score-api block must exist in registry.yaml');
  assert.match(block![0], /beacon_url: https:\/\/score\.0xhoneyjar\.xyz/);
  assert.match(block![0], /deployment_url: https:\/\/score-api-production\.up\.railway\.app/);
  assert.match(block![0], /DORMANT/i, 'registry notes must mention dormant ECS');
});
