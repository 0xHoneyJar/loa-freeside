/**
 * Worldline coherence · score-api production URL (loa-freeside#417)
 *
 * Guards against declared-vs-live drift: score-api compute is Railway;
 * ECS world-score-api is a dormant experiment, not production.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");
const REGISTRY_ROOT = join(__dirname, "..");

export const SCORE_API_CANONICAL_PUBLIC_URL = "https://score.0xhoneyjar.xyz";

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

test("registry.yaml score-api beacon_url uses canonical public hostname (score., not score-api.)", () => {
  const yaml = readFileSync(join(REGISTRY_ROOT, "registry.yaml"), "utf8");
  const block = yaml.match(/score-api:[\s\S]*?(?=\n  [a-z-]+-api:|\nmodules:|\Z)/);
  assert.ok(block, "score-api block must exist in registry.yaml");
  assert.match(block![0], /beacon_url: https:\/\/score\.0xhoneyjar\.xyz/);
  assert.match(block![0], /deployment_url: https:\/\/score-api-production\.up\.railway\.app/);
  assert.match(block![0], /DORMANT/i, "registry notes must mention dormant ECS");
});

test("world-freeside.tf SCORE_API_URL matches canonical public URL", () => {
  const tf = readRepoFile("infrastructure/terraform/world-freeside.tf");
  assert.match(
    tf,
    new RegExp(`SCORE_API_URL\\s*=\\s*"${SCORE_API_CANONICAL_PUBLIC_URL.replace(/\./g, "\\.")}"`),
    "freeside dashboard ECS env must point at Railway-canonical score. hostname",
  );
});

test("world-score-api.tf is marked DORMANT (ECS experiment, not prod)", () => {
  const tf = readRepoFile("infrastructure/terraform/world-score-api.tf");
  assert.match(tf, /DORMANT/i, "ECS world module must be explicitly marked dormant");
  assert.match(tf, /Railway/i, "header must state Railway owns production compute");
});

test("dns worlds list excludes score-api ALB subdomain (Railway owns prod)", () => {
  const tf = readRepoFile("infrastructure/terraform/dns/honeyjar-xyz-worlds.tf");
  const setMatch = tf.match(/world_subdomains\s*=\s*var\.enable_production_api\s*\?\s*toset\(\[([\s\S]*?)\]\)/);
  assert.ok(setMatch, "world_subdomains toset must be present");
  assert.doesNotMatch(setMatch![1], /"score-api"/, "score-api must not be in ALB world_subdomains");
});

test("dns railway file declares score. CNAME to Railway", () => {
  const tf = readRepoFile("infrastructure/terraform/dns/honeyjar-xyz-railway.tf");
  assert.match(tf, /score-api-production\.up\.railway\.app/, "score. must CNAME to Railway");
  assert.match(tf, /name\s*=\s*"score\.\$\{var\.domain\}"/, "Route53 record for score. subdomain");
});
