/**
 * Render tests for the awareness catalog. Imports only the dependency-free
 * renderer (its registry import is type-only, erased at runtime), so these run
 * without resolving the registry package — pure + offline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCatalogMarkdown, renderCatalogJson } from "../src/verbs/catalog-render.js";
import type { BuildingCatalog } from "@0xhoneyjar/freeside-registry";

const cat: BuildingCatalog = {
  version: 1,
  generated_at: "2026-05-23T00:00:00Z",
  building_count: 2,
  buildings: [
    {
      slug: "sonar-api",
      visibility: "public",
      git_url: "https://github.com/0xHoneyJar/sonar-api.git",
      beacon_url: "https://sonar.0xhoneyjar.xyz/.well-known/beacon.json",
      rename: "done",
      reachable: true,
      one_liner: "Onchain event indexer",
      is_not: ["Does NOT run a chain"],
      capabilities: ["query_holdings"],
      status: "active",
      has_mcp: false,
    },
    {
      slug: "inventory-api",
      visibility: "public",
      git_url: "https://github.com/0xHoneyJar/inventory-api.git",
      beacon_url: "https://inventory.0xhoneyjar.xyz/.well-known/beacon.json",
      rename: "done",
      reachable: false,
    },
  ],
};

test("renderCatalogMarkdown: header, DAG, reachable card, unreachable card", () => {
  const md = renderCatalogMarkdown(cat);
  assert.match(md, /# The Freeside Building Network/);
  assert.match(md, /Factory floor/);
  assert.match(md, /belts run ONE way/);
  assert.match(md, /`sonar-api`/);
  assert.match(md, /run a chain/); // is_not, prefix stripped
  assert.match(md, /github\.com\/0xHoneyJar\/sonar-api/); // repo path, not bare host
  assert.match(md, /not broadcasting yet/); // inventory-api unreachable
});

test("renderCatalogJson: parses + preserves building_count", () => {
  const j = JSON.parse(renderCatalogJson(cat));
  assert.equal(j.building_count, 2);
  assert.equal(j.buildings[0].slug, "sonar-api");
});

test("renderCatalogMarkdown: sanitizes newline/markdown injection from untrusted beacon content", () => {
  const evil: BuildingCatalog = {
    version: 1,
    generated_at: "2026-05-23T00:00:00Z",
    building_count: 1,
    buildings: [
      {
        slug: "x-api",
        visibility: "public",
        git_url: "https://github.com/0xHoneyJar/x-api.git",
        beacon_url: "https://x.0xhoneyjar.xyz/.well-known/beacon.json",
        reachable: true,
        one_liner: "Legit one-liner\n\n## INJECTED HEADING",
        is_not: ["Does NOT behave\n### sneaky subheading"],
        capabilities: ["cap`break"],
        status: "active",
        has_mcp: false,
      },
    ],
  };
  const md = renderCatalogMarkdown(evil);
  assert.ok(!/\n#{2,} INJECTED/.test(md), "must not inject a heading");
  assert.ok(!/\n#{3,} sneaky/.test(md), "must not inject a subheading");
  assert.ok(!md.includes("cap`break"), "must strip backtick from capability code span");
});

test("renderCatalogMarkdown: a building absent from every DAG tier is shown as UNTIERED, not dropped", () => {
  const orphan: BuildingCatalog = {
    version: 1,
    generated_at: "2026-05-23T00:00:00Z",
    building_count: 1,
    buildings: [
      {
        slug: "billing-api",
        visibility: "public",
        git_url: "https://github.com/0xHoneyJar/billing-api.git",
        beacon_url: "https://b.0xhoneyjar.xyz/.well-known/beacon.json",
        reachable: false,
      },
    ],
  };
  const md = renderCatalogMarkdown(orphan);
  assert.match(md, /UNTIERED/);
  assert.match(md, /billing-api/);
});
