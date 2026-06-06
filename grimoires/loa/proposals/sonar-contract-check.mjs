#!/usr/bin/env node
/**
 * sonar-contract-check — "fail loud BEFORE the repoint."
 *
 * Born from the 2026-06-01 belt-gateway cutover that silently broke four CubQuests badge
 * consumers, discovered one at a time (leaderboard count → leaderboard icons → profile
 * sash → badge distribution). Every break was a query whose fields the new schema no
 * longer satisfied, swallowed into an empty result.
 *
 * This walks a consumer repo, extracts every GraphQL query it ships against a Sonar
 * endpoint, and asks the LIVE schema whether each one still resolves — turning a silent
 * runtime [] into a loud pre-deploy signal. Public index data → introspection is fair game.
 *
 * Usage: node sonar-contract-check.mjs <repoDir> <endpoint> [scanGlobDirs...]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = process.argv[2];
const ENDPOINT = process.argv[3];
const SCAN_DIRS = process.argv.slice(4).length ? process.argv.slice(4) : ["lib", "hooks", "src"];

if (!REPO || !ENDPOINT) {
  console.error("usage: sonar-contract-check.mjs <repoDir> <endpoint> [dirs...]");
  process.exit(2);
}

// ---- 1. walk source, collect .ts/.tsx ------------------------------------------------
function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e === ".git" || e.startsWith("__tests__")) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.|\.d\.ts$/.test(e)) acc.push(p);
  }
  return acc;
}

// ---- 2. extract GraphQL query bodies from `query: \`...\`` and gql\`...\` -------------
function extractQueries(src, file) {
  const out = [];
  const re = /(?:query\s*:\s*`|gql\s*`)([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[1];
    // must look like a GraphQL operation (a root field selection)
    if (!/[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(body) && !/\b(query|mutation)\b/.test(body)) continue;
    const lineNo = src.slice(0, m.index).split("\n").length;
    out.push({ body, ref: `${file}:${lineNo}` });
  }
  return out;
}

// ---- 3. neutralize ${...} interpolation + synthesize dummy variables -----------------
function dummyFor(type) {
  const t = type.replace(/[!\[\]]/g, "");
  if (/String|ID/i.test(t)) return "0x0000000000000000000000000000000000000000";
  if (/Int|numeric|bigint|float|Float/i.test(t)) return 0;
  if (/Boolean/i.test(t)) return false;
  return "0"; // custom scalars — best effort
}
function prep(body) {
  // template interpolations are almost always values (tokenId / address) — 0 keeps the
  // STRUCTURE valid, which is all we need for field-existence validation.
  const query = body.replace(/\$\{[^}]*\}/g, "0");
  const variables = {};
  const vre = /\$([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_!\[\]]+)/g;
  let vm;
  while ((vm = vre.exec(query))) variables[vm[1]] = dummyFor(vm[2]);
  // a name for reporting: first root field
  const fieldMatch = query.match(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[\({]/) || query.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  return { query, variables, rootField: fieldMatch ? fieldMatch[1] : "?" };
}

// ---- 4. probe the live endpoint, classify -------------------------------------------
async function probe({ query, variables }) {
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json().catch(() => ({}));
    const errs = j.errors || [];
    // validation-failed / field-not-found = the schema rejects this query = WILL break
    const fatal = errs.filter((e) =>
      /not found|validation-failed|Cannot query field|Unknown argument|unknown field|no field/i.test(
        (e.message || "") + JSON.stringify(e.extensions || {}),
      ),
    );
    if (fatal.length) return { status: "BROKEN", detail: fatal.map((e) => e.message).join("; ").slice(0, 200) };
    // other errors (e.g. variable coercion from our dummy values) are not schema-breaks
    if (errs.length) return { status: "ok*", detail: "resolves; non-schema error from dummy vars: " + errs[0].message.slice(0, 80) };
    return { status: "OK", detail: "" };
  } catch (e) {
    return { status: "UNREACHABLE", detail: String(e).slice(0, 120) };
  }
}

// ---- run -----------------------------------------------------------------------------
const files = SCAN_DIRS.flatMap((d) => walk(join(REPO, d)));
const queries = [];
const seen = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!/NEXT_PUBLIC_GRAPHQL_ENDPOINT|createGraphQLClient|gql`/.test(src)) continue; // only Sonar consumers
  for (const q of extractQueries(src, relative(REPO, f))) {
    const key = q.body.replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(q);
  }
}

console.log(`\n∴ SONAR CONTRACT CHECK  ${ENDPOINT}`);
console.log(`  repo: ${REPO}  ·  ${queries.length} distinct queries found in ${files.length} files\n`);

let broken = 0;
for (const q of queries) {
  const { query, variables, rootField } = prep(q.body);
  const res = await probe({ query, variables });
  if (res.status === "BROKEN") broken++;
  const glyph = res.status === "OK" ? "✓" : res.status === "BROKEN" ? "✗" : res.status === "ok*" ? "~" : "?";
  console.log(`  ${glyph} [${res.status}] ${rootField.padEnd(16)} ${q.ref}`);
  if (res.detail) console.log(`      ${res.detail}`);
}
console.log(`\n  ${broken === 0 ? "✓ all queries resolve against the live schema" : `✗ ${broken} querie(s) WOULD BREAK against ${ENDPOINT}`}\n`);
process.exit(broken > 0 ? 1 : 0);
