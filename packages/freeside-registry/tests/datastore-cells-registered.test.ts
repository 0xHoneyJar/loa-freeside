/**
 * Unit test · datastore-legibility S1-T1 — the four in-monolith cells are
 * registered as modules (SDD A-1: "register the cells first"). Before the
 * data-store surface can make them legible, the registry must know they exist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(here, "..", "registry.yaml");

const NEW_CELLS = ["shadow-mode", "shadow-audit", "worker", "operator-dash"] as const;

test("the four in-monolith cells are registered as internal modules", () => {
  const registry = loadRegistry(REGISTRY);
  for (const slug of NEW_CELLS) {
    const entry = registry.modules[slug];
    assert.ok(entry, `${slug} must be a registered module`);
    assert.equal(entry.visibility, "internal", `${slug} is internal`);
    assert.equal(entry.git_url, "https://github.com/0xHoneyJar/loa-freeside.git", `${slug} is in-monolith`);
  }
});

test("registration does not disturb the existing ordering entry", () => {
  const registry = loadRegistry(REGISTRY);
  const ordering = registry.modules["ordering"];
  assert.ok(ordering);
  assert.equal(ordering.deployment_url, "https://ordering-service-production.up.railway.app");
});
