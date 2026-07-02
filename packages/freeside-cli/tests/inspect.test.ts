/**
 * Contract tests · `inspectModule` (beacon-consumer S1-T4, SDD D5).
 *
 * Network-free: every case injects a mock fetcher + a cast registry, so the full
 * fetch→validate→classify→exit pipeline is exercised without a live socket. Each test
 * pins one classification → exit-code row of the SDD D5 table (G-5: the same table
 * `loa model` reads, via the shared BEACON_EXIT export).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Registry } from "@freeside/freeside-registry";
import { inspectModule } from "../src/verbs/inspect.js";
import type { RemoteFetchResult } from "../src/lib/harden-beacon-fetch.js";

const SCORE_URL = "https://score.0xhoneyjar.xyz/.well-known/beacon.json";

/** A valid BeaconV3 body for `slug` (mirrors doctor.test.ts's validBeaconBody). */
const validBeaconBody = (slug: string): string =>
  JSON.stringify({
    schema_version: "3",
    slug,
    publisher: "0xHoneyJar",
    is: {
      one_liner: "Reputation score API for registered worlds",
      scope: ["Compute per-member scores", "Serve score snapshots"],
    },
    is_not: ["Does NOT mint tokens", "Will NOT proxy chain RPC"],
    composes_with: {
      "sonar-api": { role: "consumes raw signal", tag: "SonarPort@2.1.0+a3f2c891d4", required: true },
    },
    cycle_state: { status: "active", since: "2026-05-18", next_review: "2026-08-18" },
  });

/** Minimal registry with one module (cast — inspectModule only reads modules[slug] fields). */
const makeRegistry = (
  slug: string,
  entry: { beacon_url: string | null; deployment_url?: string | null; runtime_state?: string | null },
): Registry => ({ version: 1, modules: { [slug]: entry } }) as unknown as Registry;

/** A one-shot fetcher that returns `result` for any URL (network-free). */
const fetcherReturning = (result: RemoteFetchResult) => async (): Promise<RemoteFetchResult> => result;

const ok = (body: string, finalUrl = SCORE_URL): RemoteFetchResult => ({ status: 200, finalUrl, body });

// ── happy path ───────────────────────────────────────────────────────────────

test("valid beacon, slug match → beacon_valid, exit 0, full packet", async () => {
  const r = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL, deployment_url: "https://score-api.up.railway.app", runtime_state: "deployed" }),
    fetcher: fetcherReturning(ok(validBeaconBody("score-api"))),
  });
  assert.equal(r.exit, 0);
  assert.equal(r.error, undefined);
  assert.equal(r.packet?.verdict.classification, "beacon_valid");
  assert.equal(r.packet?.verdict.beacon_valid, true);
  assert.equal(r.packet?.publisher, "0xHoneyJar");
  assert.equal(r.packet?.is, "Reputation score API for registered worlds"); // is.one_liner flattened
  assert.equal(r.packet?.cycle_state, "active"); // cycle_state.status flattened
  assert.deepEqual(r.packet?.composes_with, { "sonar-api": "SonarPort@2.1.0+a3f2c891d4" }); // edge → tag
  assert.equal(r.packet?.deployment_url, "https://score-api.up.railway.app");
  assert.equal(r.packet?.runtime_state, "deployed");
});

// ── classification → exit rows ────────────────────────────────────────────────

test("valid beacon, slug MISMATCH → beacon_dark, exit 4, beacon fields null", async () => {
  const r = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL }),
    fetcher: fetcherReturning(ok(validBeaconBody("activities-api"))), // sibling's beacon at this URL
  });
  assert.equal(r.exit, 4);
  assert.equal(r.packet?.verdict.classification, "beacon_dark");
  assert.equal(r.packet?.verdict.detail, "slug_mismatch");
  assert.equal(r.packet?.publisher, null);
  assert.equal(r.packet?.is, null);
  assert.equal(r.raw, null);
});

test("2xx non-beacon JSON body → beacon_invalid, exit 3", async () => {
  const r = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL }),
    fetcher: fetcherReturning(ok(JSON.stringify({ hello: "world" }))),
  });
  assert.equal(r.exit, 3);
  assert.equal(r.packet?.verdict.classification, "beacon_invalid");
  assert.equal(r.packet?.verdict.detail, "invalid_beacon");
});

test("404 at the declared host → beacon_dark, exit 4, not_found", async () => {
  const r = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL }),
    fetcher: fetcherReturning({ status: 404, finalUrl: SCORE_URL, body: "" }),
  });
  assert.equal(r.exit, 4);
  assert.equal(r.packet?.verdict.classification, "beacon_dark");
  assert.equal(r.packet?.verdict.detail, "not_found");
});

test("off-host redirect (finalUrl host differs) → beacon_void, exit 5", async () => {
  const r = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL }),
    fetcher: fetcherReturning({ status: 200, finalUrl: "https://cname.vercel-dns.com/x", body: "" }),
  });
  assert.equal(r.exit, 5);
  assert.equal(r.packet?.verdict.classification, "beacon_void");
  assert.equal(r.packet?.verdict.detail, "off_host_redirect");
});

test("timeout → beacon_unreachable, exit 2", async () => {
  const r = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL }),
    fetcher: fetcherReturning({ status: 0, finalUrl: SCORE_URL, body: "", error: "timeout" }),
  });
  assert.equal(r.exit, 2);
  assert.equal(r.packet?.verdict.classification, "beacon_unreachable");
  assert.equal(r.packet?.verdict.detail, "timeout");
});

test("oversize body → beacon_invalid, exit 3 (distinct from other transport errors)", async () => {
  const r = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL }),
    fetcher: fetcherReturning({ status: 200, finalUrl: SCORE_URL, body: "", error: "oversize" }),
  });
  assert.equal(r.exit, 3);
  assert.equal(r.packet?.verdict.classification, "beacon_invalid");
  assert.equal(r.packet?.verdict.detail, "oversize");
});

test("pre-fetch guard reject (host_not_allowlisted) → beacon_unreachable, exit 2, enumerated detail", async () => {
  const r = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL }),
    fetcher: fetcherReturning({ status: 0, finalUrl: SCORE_URL, body: "", error: "host_not_allowlisted" }),
  });
  assert.equal(r.exit, 2);
  assert.equal(r.packet?.verdict.classification, "beacon_unreachable");
  assert.equal(r.packet?.verdict.detail, "host_not_allowlisted");
});

// ── registry-level outcomes (no fetch) ────────────────────────────────────────

test("unknown slug → exit 1 + sorted available_slugs, no fetch", async () => {
  let fetched = false;
  const r = await inspectModule("nope-api", {
    registry: { version: 1, modules: { "score-api": { beacon_url: SCORE_URL }, "activities-api": { beacon_url: null } } } as unknown as Registry,
    fetcher: async () => {
      fetched = true;
      return ok(validBeaconBody("nope-api"));
    },
  });
  assert.equal(r.exit, 1);
  assert.equal(r.packet, undefined);
  assert.equal(r.error?.slug, "nope-api");
  assert.deepEqual(r.error?.available_slugs, ["activities-api", "score-api"]);
  assert.equal(fetched, false, "unknown slug must short-circuit before any fetch");
});

test("null beacon_url → beacon_dark, exit 4, registry fields still render, no fetch", async () => {
  let fetched = false;
  const r = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: null, deployment_url: "https://x.up.railway.app", runtime_state: "scaffolded" }),
    fetcher: async () => {
      fetched = true;
      return ok(validBeaconBody("score-api"));
    },
  });
  assert.equal(r.exit, 4);
  assert.equal(r.packet?.verdict.classification, "beacon_dark");
  assert.equal(r.packet?.deployment_url, "https://x.up.railway.app");
  assert.equal(r.packet?.runtime_state, "scaffolded");
  assert.equal(r.raw, null);
  assert.equal(fetched, false, "null beacon_url must not attempt a fetch");
});

// ── --raw contract (raw is the parsed body only when valid) ────────────────────

test("--raw: valid beacon exposes the parsed body; non-valid exposes null", async () => {
  const valid = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL }),
    fetcher: fetcherReturning(ok(validBeaconBody("score-api"))),
  });
  assert.equal((valid.raw as { slug?: string })?.slug, "score-api");

  const invalid = await inspectModule("score-api", {
    registry: makeRegistry("score-api", { beacon_url: SCORE_URL }),
    fetcher: fetcherReturning(ok(JSON.stringify({ not: "a beacon" }))),
  });
  assert.equal(invalid.raw, null);
});
