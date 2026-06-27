/**
 * Unit + CLI tests · freeside-cli doctor (sprint-400 T4)
 *
 * Pure helpers tested inline (variants built by spreading a decoded base beacon
 * — `loadBeacon` does the YAML parse, so the test needs no yaml dep). doctor()
 * integration + the built-CLI exit-code smoke cover G-1/G-2/G-6/G-7.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBeacon, loadRegistry } from "@freeside/freeside-registry";
import type { BeaconV3 } from "@freeside/beacon-schema";
import {
  doctor,
  checkCycleState,
  checkComposesWith,
  checkSealedSchemas,
  recomputeSealedHash,
  readAllowlist,
  classifyProbe,
  probeBeacon,
  type BeaconFetcher,
  type BeaconProbe,
} from "../src/verbs/doctor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");
const CLI = join(__dirname, "..", "dist", "bin", "freeside-cli.js");
const NOW = new Date("2026-06-01T00:00:00Z");

// decoded base BeaconV3 (loadBeacon parses the YAML — no yaml dep needed here)
const base: BeaconV3 = (() => {
  const r = loadBeacon({ beacon_fixture: "base-v3.yaml", beacon_url: "" }, FIXTURES);
  if (r.kind !== "v3") throw new Error(`base-v3 fixture did not decode as v3: ${r.kind === "error" ? r.error : r.kind}`);
  return r.beacon;
})();
const variant = (over: Record<string, unknown>): BeaconV3 =>
  ({ ...base, ...over } as unknown as BeaconV3);

// ─── checkCycleState ────────────────────────────────────────────────────────

test("checkCycleState · next_review in the past → cycle_review_overdue warn", () => {
  const b = variant({ cycle_state: { status: "active", since: "2026-01-01", next_review: "2026-02-01" } });
  const f = checkCycleState("x", b, NOW);
  assert.ok(f.some((x) => x.check === "cycle_review_overdue" && x.severity === "warn"));
});

test("checkCycleState · review window > 180d → cycle_review_window_exceeded error", () => {
  const b = variant({ cycle_state: { status: "active", since: "2026-01-01", next_review: "2026-12-01" } });
  const f = checkCycleState("x", b, NOW);
  assert.ok(f.some((x) => x.check === "cycle_review_window_exceeded" && x.severity === "error"));
});

test("checkCycleState · fresh + in-window → no findings", () => {
  const b = variant({ cycle_state: { status: "candidate", since: "2026-05-18", next_review: "2026-08-18" } });
  assert.equal(checkCycleState("x", b, NOW).length, 0);
});

// ─── checkComposesWith ──────────────────────────────────────────────────────

test("checkComposesWith · key not a registry slug → compose_unknown_sibling error", () => {
  // base-v3 composes_with freeside-sonar/freeside-storage — NOT slugs in the test registry
  const reg = loadRegistry(join(FIXTURES, "registry-fixture.yaml"));
  const f = checkComposesWith("x", base, reg);
  const unknown = f.filter((x) => x.check === "compose_unknown_sibling" && x.severity === "error");
  assert.ok(unknown.length >= 1, "expected at least one unknown-sibling error");
});

test("checkComposesWith · key IS a registry slug → tag_hash_unverified warn (OD-2)", () => {
  const reg = loadRegistry(join(FIXTURES, "registry-fixture.yaml"));
  const b = variant({ composes_with: { "good-api": { role: "r", tag: "P@1.0.0+a1b2c3d4", required: false } } });
  const f = checkComposesWith("x", b, reg);
  assert.ok(f.some((x) => x.check === "tag_hash_unverified" && x.severity === "warn"));
  assert.ok(!f.some((x) => x.check === "compose_unknown_sibling"));
});

// ─── recomputeSealedHash + checkSealedSchemas ───────────────────────────────

test("recomputeSealedHash · canonicalizes key order (JCS) → same hash", () => {
  const a = recomputeSealedHash('{"b":2,"a":1}');
  const b = recomputeSealedHash('{"a":1,"b":2}');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("checkSealedSchemas · all-zeros placeholder hash → sealed_schema_hash_drift error", () => {
  const b = variant({ sealed_schemas: [{ path: "s.json", hash: "0".repeat(64), consumers: [] }] });
  const f = checkSealedSchemas("x", b, () => '{"x":1}');
  assert.ok(f.some((x) => x.check === "sealed_schema_hash_drift" && x.severity === "error"));
});

test("checkSealedSchemas · recomputed hash matches declared → sealed_schema_ok", () => {
  const good = recomputeSealedHash('{"x":1}');
  const b = variant({ sealed_schemas: [{ path: "s.json", hash: good, consumers: [] }] });
  const f = checkSealedSchemas("x", b, (p) => (p === "s.json" ? '{"x":1}' : null));
  assert.ok(f.some((x) => x.check === "sealed_schema_ok" && x.severity === "ok"));
});

test("checkSealedSchemas · declared ≠ recomputed → sealed_schema_hash_drift error", () => {
  const b = variant({ sealed_schemas: [{ path: "s.json", hash: "a".repeat(64), consumers: [] }] });
  const f = checkSealedSchemas("x", b, () => '{"x":1}');
  assert.ok(f.some((x) => x.check === "sealed_schema_hash_drift" && x.severity === "error"));
});

test("checkSealedSchemas · schema unresolvable → sealed_schema_unverified warn", () => {
  const b = variant({ sealed_schemas: [{ path: "s.json", hash: "b".repeat(64), consumers: [] }] });
  const f = checkSealedSchemas("x", b, () => null);
  assert.ok(f.some((x) => x.check === "sealed_schema_unverified" && x.severity === "warn"));
});

// ─── readAllowlist ──────────────────────────────────────────────────────────

test("readAllowlist · parses the flat allowlist shape (slug/id/expires)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-al-"));
  try {
    const p = join(dir, "al.yaml");
    writeFileSync(
      p,
      [
        "# comment",
        "version: 1",
        "allowlist:",
        "  - slug: sonar-api",
        "    id: event_completeness",
        '    expires: "2026-08-30"',
        '    reason: "KF-012 — note with: colons and (parens)"',
        "  - slug: identity-api",
        "    id: audit_replay",
        '    expires: "2026-09-30"',
        "    reason: storage-bound",
      ].join("\n"),
    );
    const al = readAllowlist(p);
    assert.equal(al.length, 2);
    assert.deepEqual(al[0], { slug: "sonar-api", id: "event_completeness", expires: "2026-08-30" });
    assert.equal(al[1].slug, "identity-api");
    assert.equal(al[1].expires, "2026-09-30");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readAllowlist · missing file → empty array (graceful)", () => {
  assert.deepEqual(readAllowlist(join(tmpdir(), "does-not-exist-xyz.yaml")), []);
});

// ─── doctor() integration ───────────────────────────────────────────────────

test("doctor() · audits every module (≥1 finding each) and detects the bad hash", async () => {
  const report = await doctor({
    registryPath: join(FIXTURES, "registry-fixture.yaml"),
    allowlistPath: join(FIXTURES, "no-allowlist.yaml"), // absent → []
    now: NOW,
  });
  assert.equal(report.modules_checked, 2);
  // G-1: each module yields ≥1 finding
  for (const slug of ["good-api", "bad-api"]) {
    assert.ok(report.findings.some((f) => f.slug === slug), `no findings for ${slug}`);
  }
  // G-2: bad-api all-zeros sealed hash → error
  assert.ok(
    report.findings.some((f) => f.slug === "bad-api" && f.check === "sealed_schema_hash_drift" && f.severity === "error"),
  );
  assert.ok(report.summary.error >= 1);
});

test("doctor() · deterministic modulo checked_at (G-7)", async () => {
  const opts = { registryPath: join(FIXTURES, "registry-fixture.yaml"), now: NOW };
  const a = await doctor(opts);
  const b = await doctor(opts);
  const strip = (r: Awaited<ReturnType<typeof doctor>>) => ({ ...r, checked_at: "X" });
  assert.deepEqual(strip(a), strip(b));
});

test("doctor() · --acvp (acvpOnly) skips cycle/compose/sealed; beacon-resolve + ACVP only (FAGAN)", async () => {
  const report = await doctor({ registryPath: join(FIXTURES, "registry-fixture.yaml"), acvpOnly: true, now: NOW });
  // non-ACVP checks must be skipped — bad-api's sealed_schema_hash_drift in particular
  assert.ok(!report.findings.some((f) => f.check === "sealed_schema_hash_drift"));
  assert.ok(!report.findings.some((f) => f.check === "tag_hash_unverified"));
  assert.ok(!report.findings.some((f) => f.check.startsWith("cycle_")));
  // beacon resolution still happens (ACVP needs a decoded beacon)
  assert.ok(report.findings.some((f) => f.check === "beacon_valid"));
});

// ─── --remote host-pinned probe + host-integrity guard (SC-6 un-deferred) ────
// The beacon-discovery sensor. A mock fetcher (NO live network) drives the three
// verdicts; the gate WARNs only on public+deployed cells that go dark, and is
// silent on honestly-scaffolded ones.

/** A minimal but schema-valid BeaconV3 served at a beacon_url (the "discoverable" body). */
const VALID_BEACON_BODY = JSON.stringify({
  schema_version: "3",
  slug: "activities-api",
  publisher: "0xHoneyJar",
  is: {
    one_liner: "Activity feed aggregator for registered worlds",
    scope: ["Aggregate per-world activity events", "Surface a unified activity timeline"],
  },
  is_not: ["Does NOT mint or burn tokens", "Will NOT proxy chain RPC calls"],
  cycle_state: { status: "active", since: "2026-05-18", next_review: "2026-08-18" },
});

/** Route declared URLs → canned fetch results; an unrouted URL is a transport failure. */
const mockFetcher = (routes: Record<string, { status: number; finalUrl?: string; body?: string }>): BeaconFetcher =>
  async (url) => {
    const r = routes[url];
    if (!r) return { status: 0, finalUrl: url, body: "", error: "no route (mock)" };
    return { status: r.status, finalUrl: r.finalUrl ?? url, body: r.body ?? "" };
  };

/** Write a temp registry with the given module YAML block; returns its path + cleanup. */
function writeRemoteRegistry(moduleYaml: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "doctor-remote-"));
  const path = join(dir, "registry.yaml");
  writeFileSync(path, `version: 1\nmodules:\n${moduleYaml}`);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const SCORE_URL = "https://score.0xhoneyjar.xyz/.well-known/beacon.json";
const MINT_URL = "https://mint.0xhoneyjar.xyz/.well-known/beacon.json";

// ── classifyProbe (pure guard) ──────────────────────────────────────────────

test("classifyProbe · redirected off the declared host → void (before anything else)", () => {
  const p: BeaconProbe = {
    target: SCORE_URL, declaredHost: "score.0xhoneyjar.xyz", finalHost: "cname.vercel-dns.com",
    redirectedOff: true, status: 200, bodyValid: true,
  };
  assert.equal(classifyProbe(p), "void");
});

test("classifyProbe · 2xx valid body at declared host → discoverable", () => {
  const p: BeaconProbe = {
    target: SCORE_URL, declaredHost: "score.0xhoneyjar.xyz", finalHost: "score.0xhoneyjar.xyz",
    redirectedOff: false, status: 200, bodyValid: true,
  };
  assert.equal(classifyProbe(p), "discoverable");
});

test("classifyProbe · correctly-targeted host that 404s / serves non-BeaconV3 → dark", () => {
  const notFound: BeaconProbe = {
    target: SCORE_URL, declaredHost: "score.0xhoneyjar.xyz", finalHost: "score.0xhoneyjar.xyz",
    redirectedOff: false, status: 404, bodyValid: false,
  };
  assert.equal(classifyProbe(notFound), "dark");
  // 200 but body not a BeaconV3 → still dark
  assert.equal(classifyProbe({ ...notFound, status: 200, bodyValid: false }), "dark");
});

// ── probeBeacon (host-integrity guard record) ───────────────────────────────

test("probeBeacon · records the post-redirect host; off-host probe flags redirectedOff", async () => {
  const fetcher = mockFetcher({
    [SCORE_URL]: { status: 200, finalUrl: "https://cname.vercel-dns.com/404", body: "<html>nope" },
  });
  const p = await probeBeacon(SCORE_URL, fetcher);
  assert.equal(p.declaredHost, "score.0xhoneyjar.xyz");
  assert.equal(p.finalHost, "cname.vercel-dns.com");
  assert.equal(p.redirectedOff, true);
  assert.equal(p.bodyValid, false);
  assert.equal(classifyProbe(p), "void");
});

test("probeBeacon · valid BeaconV3 body at the declared host → bodyValid true, not redirected", async () => {
  const fetcher = mockFetcher({ [SCORE_URL]: { status: 200, body: VALID_BEACON_BODY } });
  const p = await probeBeacon(SCORE_URL, fetcher);
  assert.equal(p.redirectedOff, false);
  assert.equal(p.bodyValid, true);
  assert.equal(classifyProbe(p), "discoverable");
});

// ── the gate, gated on truth-state ──────────────────────────────────────────

test("doctor() · --remote → public+deployed cell whose beacon 404s → beacon_dark WARN (no fixture, no error)", async () => {
  const { path, cleanup } = writeRemoteRegistry(
    [
      "  score-api:",
      "    git_url: https://github.com/0xHoneyJar/score-api.git",
      `    beacon_url: ${SCORE_URL}`,
      "    visibility: public",
      "    owner: 0xHoneyJar",
      '    added: "2026-05-30"',
      "    runtime_state: deployed",
      "",
    ].join("\n"),
  );
  try {
    const report = await doctor({
      registryPath: path,
      remote: true,
      now: NOW,
      fetchBeacon: mockFetcher({ [SCORE_URL]: { status: 404, body: "Not Found" } }),
    });
    assert.ok(
      report.findings.some((f) => f.slug === "score-api" && f.check === "beacon_dark" && f.severity === "warn"),
      "public+deployed dark beacon must WARN (beacon_dark)",
    );
    assert.equal(report.summary.error, 0, "the gate WARNs now (does not FAIL)");
    // --remote never substitutes the fixture path
    assert.ok(!report.findings.some((f) => f.check === "beacon_valid" || f.check === "beacon_unreachable"));
  } finally {
    cleanup();
  }
});

test("doctor() · --remote → cell serving a valid BeaconV3 → beacon_discoverable (pass)", async () => {
  const { path, cleanup } = writeRemoteRegistry(
    [
      "  activities-api:",
      "    git_url: https://github.com/0xHoneyJar/activities-api.git",
      "    beacon_url: https://activities.0xhoneyjar.xyz/.well-known/beacon.json",
      "    visibility: public",
      "    owner: 0xHoneyJar",
      '    added: "2026-05-30"',
      "    runtime_state: deployed",
      "",
    ].join("\n"),
  );
  const url = "https://activities.0xhoneyjar.xyz/.well-known/beacon.json";
  try {
    const report = await doctor({
      registryPath: path,
      remote: true,
      now: NOW,
      fetchBeacon: mockFetcher({ [url]: { status: 200, body: VALID_BEACON_BODY } }),
    });
    assert.ok(
      report.findings.some((f) => f.slug === "activities-api" && f.check === "beacon_discoverable" && f.severity === "ok"),
      "valid BeaconV3 at the declared host → beacon_discoverable ok",
    );
    assert.equal(report.summary.warn, 0);
    assert.equal(report.summary.error, 0);
  } finally {
    cleanup();
  }
});

test("doctor() · --remote → scaffolded cell whose beacon 404s → beacon_exempt (no alarm)", async () => {
  const { path, cleanup } = writeRemoteRegistry(
    [
      "  mint-api:",
      "    git_url: https://github.com/0xHoneyJar/mint-api.git",
      `    beacon_url: ${MINT_URL}`,
      "    visibility: public",
      "    owner: 0xHoneyJar",
      '    added: "2026-05-30"',
      "    runtime_state: scaffolded",
      "",
    ].join("\n"),
  );
  try {
    const report = await doctor({
      registryPath: path,
      remote: true,
      now: NOW,
      fetchBeacon: mockFetcher({ [MINT_URL]: { status: 404, body: "Not Found" } }),
    });
    assert.ok(
      report.findings.some((f) => f.slug === "mint-api" && f.check === "beacon_exempt" && f.severity === "ok"),
      "scaffolded cell must be exempt — no false alarm",
    );
    assert.ok(
      !report.findings.some((f) => f.slug === "mint-api" && f.check === "beacon_dark"),
      "a scaffolded cell must NOT be flagged dark",
    );
    assert.equal(report.summary.warn, 0);
  } finally {
    cleanup();
  }
});

test("doctor() · --remote → public+deployed cell whose probe redirects off-host → beacon_void WARN (not dark)", async () => {
  const { path, cleanup } = writeRemoteRegistry(
    [
      "  score-api:",
      "    git_url: https://github.com/0xHoneyJar/score-api.git",
      `    beacon_url: ${SCORE_URL}`,
      "    visibility: public",
      "    owner: 0xHoneyJar",
      '    added: "2026-05-30"',
      "    runtime_state: deployed",
      "",
    ].join("\n"),
  );
  try {
    const report = await doctor({
      registryPath: path,
      remote: true,
      now: NOW,
      // declared score host redirects off to a Vercel CNAME (the score/sonar DNS class)
      fetchBeacon: mockFetcher({
        [SCORE_URL]: { status: 200, finalUrl: "https://cname.vercel-dns.com/404", body: VALID_BEACON_BODY },
      }),
    });
    assert.ok(
      report.findings.some((f) => f.slug === "score-api" && f.check === "beacon_void" && f.severity === "warn"),
      "off-host redirect → beacon_void (the host-integrity guard fires)",
    );
    assert.ok(
      !report.findings.some((f) => f.slug === "score-api" && f.check === "beacon_dark"),
      "a redirected-off probe must NOT be counted as dark",
    );
  } finally {
    cleanup();
  }
});

test("doctor() · BeaconV2 module → beacon_legacy_v2 warn, NOT error (G-4)", async () => {
  const report = await doctor({ registryPath: join(FIXTURES, "registry-legacy-fixture.yaml"), now: NOW });
  assert.equal(report.modules_checked, 1);
  assert.ok(
    report.findings.some((f) => f.slug === "legacy-api" && f.check === "beacon_legacy_v2" && f.severity === "warn"),
    "expected a beacon_legacy_v2 warn for the V2 module",
  );
  // V2 detection is a migration warn (ADR-007 A.4), never a hard error
  assert.ok(!report.findings.some((f) => f.slug === "legacy-api" && f.severity === "error"));
});

// ─── built CLI smoke (G-6 exit code) ────────────────────────────────────────

test("CLI · doctor --registry <bad> → exit 1 (sealed_schema_hash_drift)", () => {
  if (!existsSync(CLI)) throw new Error(`CLI not built at ${CLI} — run \`pnpm build\` first`);
  let exitCode = 0;
  try {
    execFileSync("node", [CLI, "doctor", "--registry", join(FIXTURES, "registry-fixture.yaml")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    exitCode = (e as { status?: number }).status ?? -1;
  }
  assert.equal(exitCode, 1, "expected exit 1 when a module has an error finding");
});

// ─── --cells-dir per-cell resolution + FL-B0 git-freshness (sprint-400 step 3) ──
// Builds a real git cell clone at <tmp>/cell-test-api: commit the proof+beacon
// (c1), publish a receipt recording c1, then COMMIT the receipt (c2 — HEAD now
// past c1). Exact-HEAD match cannot accept this, but the git-freshness resolver
// (proof unchanged between c1 and HEAD) marks it fresh → bound. The mutate
// variant changes the proof after the receipt → stale → warn.

const CELL_BEACON_YAML = [
  'schema_version: "3"',
  'slug: "test-api"',
  'publisher: "0xHoneyJar"',
  "is:",
  '  one_liner: "Test cell for per-cell resolution"',
  "  scope:",
  '    - "decode round-trips"',
  '    - "totality holds"',
  "is_not:",
  '  - "Does NOT do real work"',
  '  - "Will NOT ship breaking changes"',
  "acvp_invariants:",
  "  - id: schema_enforcement",
  '    scope: "decode round-trips identically"',
  '    proof_artifact: "tests/proof.test.ts"',
  "cycle_state:",
  "  status: candidate",
  '  since: "2026-05-18"',
  '  next_review: "2026-08-18"',
  "",
].join("\n");

function initCellRepo(
  opts: { mutateProofAfterReceipt?: boolean; uncommittedReceipt?: boolean; mutateWorkingTreeBeacon?: boolean } = {},
): {
  cellsDir: string;
  cleanup: () => void;
} {
  const cellsDir = mkdtempSync(join(tmpdir(), "doctor-cells-"));
  const cell = join(cellsDir, "cell-test-api");
  const w = (rel: string, body: string) => {
    const p = join(cell, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  const git = (...a: string[]) => execFileSync("git", ["-C", cell, ...a], { stdio: "ignore" });

  w("packages/protocol/beacon.yaml", CELL_BEACON_YAML);
  w("package.json", JSON.stringify({ name: "test-api", version: "0.0.0" }) + "\n");
  w("tests/proof.test.ts", "// proof v1\n");
  execFileSync("git", ["init", "-q", cell], { stdio: "ignore" });
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "c1: cell + proof");
  const c1 = execFileSync("git", ["-C", cell, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim();

  // publish the receipt recording c1, then COMMIT it → HEAD advances past c1
  w(
    "app/.well-known/acvp-proof-receipt.json",
    JSON.stringify(
      [
        {
          slug: "test-api",
          invariant_id: "schema_enforcement",
          proof_artifact: "tests/proof.test.ts",
          test_runner: "bun",
          passed_at: "2026-05-30T00:00:00Z",
          commit_sha: c1,
        },
      ],
      null,
      2,
    ) + "\n",
  );
  if (opts.uncommittedReceipt) {
    // leave the receipt in the WORKING TREE only — never committed. doctor reads
    // evidence from the audited commit (git show HEAD:…), so this must NOT count.
  } else {
    git("add", "-A");
    git("commit", "-q", "-m", "c2: receipt");

    if (opts.mutateProofAfterReceipt) {
      w("tests/proof.test.ts", "// proof v2 — CHANGED after the receipt was issued\n");
      git("add", "-A");
      git("commit", "-q", "-m", "c3: proof changed");
    }
  }

  if (opts.mutateWorkingTreeBeacon) {
    // overwrite beacon.yaml in the WORKING TREE only (NOT committed) — inject an
    // envelope-bound invariant that would surface a runtime error if doctor read
    // the working tree instead of the committed HEAD.
    w(
      "packages/protocol/beacon.yaml",
      CELL_BEACON_YAML.replace(
        "acvp_invariants:\n",
        [
          "acvp_invariants:",
          "  - id: hash_chain",
          '    scope: "injected via the working tree — must be invisible to doctor"',
          '    proof_artifact: "tests/hash_chain.test.ts"',
          "",
        ].join("\n"),
      ),
    );
  }

  // registry points test-api at the clone (beacon resolved FROM the clone, no fixture)
  writeFileSync(
    join(cellsDir, "registry.yaml"),
    [
      "version: 1",
      "modules:",
      "  test-api:",
      "    git_url: https://example.com/test-api.git",
      '    beacon_url: ""',
      "    visibility: public",
      "    owner: o",
      '    added: "2026-05-30"',
      "",
    ].join("\n"),
  );

  return { cellsDir, cleanup: () => rmSync(cellsDir, { recursive: true, force: true }) };
}

test("doctor() · --cells-dir → resolves beacon+receipt from clone; committed receipt fresh → acvp_proof ok, no error (FL-B0 bridge)", async () => {
  const { cellsDir, cleanup } = initCellRepo();
  try {
    const report = await doctor({
      registryPath: join(cellsDir, "registry.yaml"),
      cellsDir,
      acvpOnly: true,
      now: NOW,
    });
    assert.ok(
      report.findings.some(
        (f) => f.slug === "test-api" && f.check === "acvp_proof:schema_enforcement" && f.severity === "ok",
      ),
      "committed receipt with unchanged proof must resolve fresh → acvp_proof ok",
    );
    assert.ok(
      !report.findings.some((f) => f.slug === "test-api" && f.severity === "error"),
      "a receipt-backed cell must produce no error",
    );
  } finally {
    cleanup();
  }
});

test("doctor() · --cells-dir → UNCOMMITTED receipt does NOT fabricate bound (committed-evidence only; no file-presence fallback — FAGAN gpt/opus)", async () => {
  const { cellsDir, cleanup } = initCellRepo({ uncommittedReceipt: true });
  try {
    const report = await doctor({
      registryPath: join(cellsDir, "registry.yaml"),
      cellsDir,
      acvpOnly: true,
      now: NOW,
    });
    // receipt is in the working tree but NOT in the audited commit, and cellsDir
    // mode does not trust file-presence → un-backed → error (default-FAIL)
    assert.ok(
      report.findings.some(
        (f) => f.slug === "test-api" && f.check === "acvp_proof:schema_enforcement" && f.severity === "error",
      ),
      "uncommitted receipt + present proof file must NOT yield ok — un-backed error",
    );
    assert.ok(
      !report.findings.some(
        (f) => f.slug === "test-api" && f.check === "acvp_proof:schema_enforcement" && f.severity === "ok",
      ),
    );
  } finally {
    cleanup();
  }
});

test("doctor() · --cells-dir set but cell clone ABSENT → beacon_unreachable warn, NO fixture substitution (FAGAN composer)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-nocell-"));
  try {
    // registry references test-api AND gives it a beacon_fixture — but there is
    // no cell-test-api/ clone. cells-dir mode must refuse to audit the fixture.
    writeFileSync(
      join(dir, "registry.yaml"),
      [
        "version: 1",
        "modules:",
        "  test-api:",
        "    git_url: https://example.com/test-api.git",
        '    beacon_url: ""',
        "    beacon_fixture: some-fixture.yaml",
        "    visibility: public",
        "    owner: o",
        '    added: "2026-05-30"',
        "",
      ].join("\n"),
    );
    const report = await doctor({ registryPath: join(dir, "registry.yaml"), cellsDir: dir, acvpOnly: true, now: NOW });
    assert.ok(
      report.findings.some((f) => f.slug === "test-api" && f.check === "beacon_unreachable" && f.severity === "warn"),
      "missing clone in cells-dir mode must surface as beacon_unreachable",
    );
    // and it must NOT have substituted/audited the in-repo fixture
    assert.ok(!report.findings.some((f) => f.slug === "test-api" && f.check === "beacon_valid"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor() · --cells-dir → cell clone with NO committed HEAD (git init, no commit) → beacon_invalid, no fixture [BR-2]", async () => {
  const cellsDir = mkdtempSync(join(tmpdir(), "doctor-nohead-"));
  try {
    const cell = join(cellsDir, "cell-test-api");
    mkdirSync(cell, { recursive: true });
    execFileSync("git", ["init", "-q", cell], { stdio: "ignore" }); // repo with no commits → HEAD unresolvable
    writeFileSync(
      join(cellsDir, "registry.yaml"),
      [
        "version: 1",
        "modules:",
        "  test-api:",
        "    git_url: https://example.com/test-api.git",
        '    beacon_url: ""',
        "    visibility: public",
        "    owner: o",
        '    added: "2026-05-30"',
        "",
      ].join("\n"),
    );
    const report = await doctor({ registryPath: join(cellsDir, "registry.yaml"), cellsDir, acvpOnly: true, now: NOW });
    assert.ok(
      report.findings.some(
        (f) =>
          f.slug === "test-api" && f.check === "beacon_invalid" && f.severity === "error" && /committed HEAD/.test(f.message),
      ),
      "no committed HEAD → beacon_invalid (cannot audit committed state)",
    );
    assert.ok(!report.findings.some((f) => f.slug === "test-api" && f.check === "beacon_valid"));
  } finally {
    rmSync(cellsDir, { recursive: true, force: true });
  }
});

test("doctor() · --cells-dir → WORKING-TREE beacon mutation is INVISIBLE (committed beacon audited — FAGAN opus)", async () => {
  const { cellsDir, cleanup } = initCellRepo({ mutateWorkingTreeBeacon: true });
  try {
    const report = await doctor({
      registryPath: join(cellsDir, "registry.yaml"),
      cellsDir,
      acvpOnly: true,
      now: NOW,
    });
    // the injected hash_chain invariant exists ONLY in the working tree → it must
    // NOT appear in any finding (doctor read the committed beacon at HEAD)
    assert.ok(
      !report.findings.some((f) => f.slug === "test-api" && /hash_chain/.test(f.check)),
      "working-tree-injected invariant must be invisible — committed beacon is the audited authority",
    );
    // committed schema_enforcement + fresh committed receipt → still ok
    assert.ok(
      report.findings.some(
        (f) => f.slug === "test-api" && f.check === "acvp_proof:schema_enforcement" && f.severity === "ok",
      ),
    );
  } finally {
    cleanup();
  }
});

test("doctor() · --cells-dir → proof CHANGED after the receipt → stale warn, no error", async () => {
  const { cellsDir, cleanup } = initCellRepo({ mutateProofAfterReceipt: true });
  try {
    const report = await doctor({
      registryPath: join(cellsDir, "registry.yaml"),
      cellsDir,
      acvpOnly: true,
      now: NOW,
    });
    assert.ok(
      report.findings.some(
        (f) => f.slug === "test-api" && f.check === "acvp_proof:schema_enforcement" && f.severity === "warn",
      ),
      "proof changed since the receipt → stale → acvp_proof warn",
    );
    assert.ok(!report.findings.some((f) => f.slug === "test-api" && f.severity === "error"));
  } finally {
    cleanup();
  }
});
