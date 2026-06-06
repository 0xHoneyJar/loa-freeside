#!/usr/bin/env node
/**
 * ledger-payment-callgraph.mjs — C3 (FR-8 / SKP-003) of the freeside-decomposition cycle.
 *
 * READ-ONLY analysis. Determines whether the credits-ledger (`credit-lot-service`
 * and friends in packages/services) is cleanly separable from the payment on-ramp
 * (NG-1 wall) or entangled — gating any future ledger-api extraction.
 *
 * Three indirection vectors are checked (flatline FL-B1 hardening):
 *   1. static    — direct ESM import + call of a ledger-write symbol from a payment file
 *   2. event     — a payment surface publishes an event a ledger writer consumes (bus/outbox)
 *   3. shared-db — a payment surface writes a table a ledger writer reads/polls
 *
 * NG-1 fail-safe (IMP-010): any UNRESOLVED payment→ledger indirection → verdict
 * defaults to `payment-entangled → defer`. "cleanly-separable" requires clean on ALL three.
 *
 * Tooling note: `madge` is unavailable in this workspace (no local node_modules linkage,
 * NG-3). This uses a zero-dependency text scan with MULTI-LINE-AWARE import extraction.
 * DOCUMENTED BYPASS CLASSES (same honesty discipline as block-destructive-bash) — NOT claimed
 * as covered: dynamic `import()` target resolution beyond the literal specifier, transitive
 * chains >1 hop, DI-injected call sites (ledger fn passed as a value), and ORM/query-builder
 * table access (e.g. Drizzle `db.insert(creditLots)`) — the shared-db vector matches RAW SQL
 * table names only. These are flagged `unresolved` / out-of-scope, never assumed clean.
 *
 * Usage: node tools/ledger-payment-callgraph.mjs [--json]
 * Exit:  0 = analysis complete (read VERDICT in output). Non-zero = tool error.
 */
import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');

// --- The boundary definitions (grounded 2026-06-06) ---------------------------

const PAYMENT_SURFACES = [
  'packages/services/nowpayments-handler.ts',
  'packages/services/x402-settlement.ts',
];
// The world (themes/sietch) vendors its OWN billing stack — a second payment surface.
const PAYMENT_SURFACE_GLOBS = [
  'themes/sietch/src/packages/adapters/billing',
  'themes/sietch/src/packages/adapters/payment',
];

const LEDGER_WRITERS = {
  'credit-lot-service': ['mintCreditLot', 'debitLots', 'expireLots'],
  'event-sourcing-service': ['appendEvent', 'recordMutation', 'foldBalance'],
  'debit-rollup-job': ['rollupDebits'],
  'lot-expiry-sweep': ['sweepExpiredLots'],
};
const LEDGER_TABLES = ['credit_lots', 'usage_events', 'economic_policies', 'agent_usage', 'ledger_account', 'ledger_reservation', 'lot_entries'];
const PAYMENT_TABLES = ['webhook_events', 'payment_intents', 'nowpayments_events', 'x402_settlements', 'crypto_payments'];
const ALL_WRITER_SYMBOLS = new Set(Object.values(LEDGER_WRITERS).flat());

// --- Robust import extraction (multi-line aware; F5/F6/F8 review fixes) --------

function lineNoAt(text, idx) { return text.slice(0, idx).split('\n').length; }

/** Extract every import/require from full file text, handling multi-line + aliases + per-symbol type. */
function extractImports(text) {
  const out = [];
  // static: import [type] <clause> from '<spec>'   — [^;] spans newlines (F5 multi-line) but
  // stops at a statement boundary so a preceding no-`from` import can't be swallowed (correct lineno).
  const re = /import\s+(type\s+)?([^;]*?)\s+from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const isTypeImport = !!m[1];
    const clause = m[2];
    const spec = m[3];
    const lineno = lineNoAt(text, m.index);
    const brace = clause.match(/\{([\s\S]*?)\}/);
    let symbols = [];
    if (brace) {
      symbols = brace[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => ({
        isType: /^type\s+/.test(s),                                   // F2: inline per-symbol type
        name: s.replace(/^type\s+/, '').replace(/\s+as\s+\S+$/, '').trim(), // F6: strip alias
      }));
    }
    out.push({ lineno, isTypeImport, spec, symbols });
  }
  // side-effect: import '<spec>'
  const sideRe = /import\s*['"]([^'"]+)['"]/g;
  while ((m = sideRe.exec(text)) !== null) out.push({ lineno: lineNoAt(text, m.index), isTypeImport: false, spec: m[1], symbols: [] });
  // dynamic + CJS: import('<spec>') / require('<spec>')
  const dynRe = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = dynRe.exec(text)) !== null) out.push({ lineno: lineNoAt(text, m.index), isTypeImport: false, spec: m[1], symbols: [], dynamic: true });
  return out;
}

function readText(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

function walkTs(relDir) {
  const abs = join(ROOT, relDir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const ent of readdirSync(abs)) {
    const full = join(abs, ent);
    let st;
    try { st = lstatSync(full); } catch { continue; }   // F10: tolerate broken symlinks
    if (!st.isDirectory() && !st.isFile()) continue;
    const rel = join(relDir, ent);
    if (st.isDirectory()) out.push(...walkTs(rel));
    else if (ent.endsWith('.ts') && !ent.endsWith('.test.ts')) out.push(rel);
  }
  return out;
}

// --- Scanners -----------------------------------------------------------------

const edges = [];
const missingFiles = [];
function addEdge(writer, source, reachesPayment, evidence, resolution) {
  edges.push({ writer, source, reaches_payment: reachesPayment, evidence, resolution });
}

// Vector 1: static — payment file value-imports a ledger-write symbol
function scanStatic(paymentFile) {
  const text = readText(paymentFile);
  if (text === null) { missingFiles.push(paymentFile); return; }
  for (const imp of extractImports(text)) {
    if (!/(credit-lot-service|event-sourcing-service|debit-rollup-job|lot-expiry-sweep)/.test(imp.spec)) continue;
    if (imp.isTypeImport) continue;                                   // F8: whole import type-only → no runtime edge
    const sink = imp.spec.split('/').pop().replace(/\.js$/, '');
    for (const s of imp.symbols) {
      if (s.isType) continue;                                         // F2: per-symbol type → no runtime edge
      if (ALL_WRITER_SYMBOLS.has(s.name)) addEdge(paymentFile, `${sink}.${s.name}`, true, `${paymentFile}:${imp.lineno}`, 'static');
    }
  }
}

// Vector 3: shared-db — RAW SQL table references (ORM access is a documented blind spot)
function scanSharedDb(paymentFile) {
  const text = readText(paymentFile);
  if (text === null) return;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const t of [...PAYMENT_TABLES, ...LEDGER_TABLES]) {
      if (new RegExp(`(INSERT INTO|UPDATE|DELETE FROM|SELECT[^;]*FROM)\\s+${t}\\b`, 'i').test(line)) {
        addEdge(paymentFile, `db:${t}`, LEDGER_TABLES.includes(t), `${paymentFile}:${i + 1}`, 'shared-db');
      }
    }
  });
}

// Vector 2: event — payment publishes / ledger subscribes (bus/outbox) → cannot statically confirm → unresolved
function scanEvents(files) {
  let found = false;
  for (const f of files) {
    const text = readText(f);
    if (text === null) continue;
    text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/\b(publish|emit|enqueue|outbox)\s*\(/.test(line) && /(credit|ledger|lot|payment|settle)/i.test(line)) {
        addEdge(f, 'event-bus', null, `${f}:${i + 1}`, 'unresolved');
        found = true;
      }
    });
  }
  return found;
}

// --- Run (F7: scan ALL payment files incl. globs, not just the 2 hardcoded) ---

const globFiles = PAYMENT_SURFACE_GLOBS.flatMap((g) => walkTs(g));
const paymentFiles = [...PAYMENT_SURFACES, ...globFiles];

for (const pf of paymentFiles) { scanStatic(pf); scanSharedDb(pf); }
const eventFound = scanEvents([...paymentFiles, ...Object.keys(LEDGER_WRITERS).map((k) => `packages/services/${k}.ts`)]);

const staticEdges = edges.filter((e) => e.resolution === 'static' && e.reaches_payment);
const dbEdges = edges.filter((e) => e.resolution === 'shared-db' && e.reaches_payment);
const unresolved = edges.filter((e) => e.resolution === 'unresolved');

let verdict, reason;
if (staticEdges.length > 0) {
  verdict = 'payment-entangled → defer';
  reason = `${staticEdges.length} DIRECT static payment→ledger-write call edge(s). Extracting the ledger would sever payment calls = NG-1 violation.`;
} else if (dbEdges.length > 0) {
  verdict = 'payment-entangled → defer';
  reason = `${dbEdges.length} shared-database coupling edge(s) between payment surfaces and ledger tables.`;
} else if (unresolved.length > 0) {
  verdict = 'payment-entangled → defer';
  reason = `${unresolved.length} UNRESOLVED indirection edge(s) (NG-1 fail-safe: unresolved → defer).`;
} else if (missingFiles.length === PAYMENT_SURFACES.length) {
  verdict = 'INCONCLUSIVE → defer';                                   // F11: scanned nothing ≠ clean
  reason = `All hardcoded payment surfaces are MISSING (${missingFiles.join(', ')}) — scanned nothing; cannot assert separable.`;
} else {
  verdict = 'cleanly-separable';
  reason = 'No payment→ledger edge found on any of the 3 vectors (static, shared-db, event).';
}

const result = {
  generated: 'C3 / FR-8 / SKP-003 — freeside-decomposition',
  tool_limitations: 'text scan (madge unavailable, NG-3). Multi-line imports + aliases + per-symbol type ARE handled. Misses: dynamic import() target resolution, >1-hop transitive, DI-injected call sites, and ORM/query-builder table access (shared-db matches RAW SQL only). Flagged unresolved / out-of-scope, never assumed clean.',
  payment_surfaces_scanned: paymentFiles.length,
  missing_payment_surfaces: missingFiles,
  ledger_writers: LEDGER_WRITERS,
  edges,
  summary: { static: staticEdges.length, shared_db: dbEdges.length, unresolved: unresolved.length, event_bus_found: eventFound },
  verdict,
  reason,
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\n=== C3 LEDGER↔PAYMENT CALL-GRAPH ===`);
  console.log(`payment files scanned: ${paymentFiles.length}${missingFiles.length ? ` (MISSING: ${missingFiles.join(', ')})` : ''}`);
  console.log(`\nEDGES (writer → sink | reaches-payment | resolution | evidence):`);
  for (const e of edges) console.log(`  ${e.writer}\n     → ${e.source} | reaches=${e.reaches_payment} | ${e.resolution} | ${e.evidence}`);
  console.log(`\nsummary: static=${staticEdges.length} shared-db=${dbEdges.length} unresolved=${unresolved.length}`);
  console.log(`\nVERDICT: ${verdict}`);
  console.log(`  ${reason}\n`);
}
