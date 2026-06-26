#!/usr/bin/env node
// =============================================================================
// events-lint — the raw-NATS-emit detection scanner (cycle-112 S2).
//
// Ships as the `events-lint` bin of @0xhoneyjar/events so ANY consumer
// (including git-tarball consumers like sonar-api in cycle-2) can self-enforce
// the schema-emission floor without copying CI config or a bash toolchain
// (FR-ADOPT-5). It is the single source of truth for DETECTION; the companion
// shrink gate (tools/check-nats-allowlist-shrinks.sh) is the source of truth
// for "the allowlist can only shrink".
//
// What it flags (outside the events package itself, node_modules, dist, tests):
//   1. `internalPublish` imported from the events package's transport module —
//      the capability deep-import (precise; FR-7/SKP-002).
//   2. A raw `.publish(` in a file that imports a NATS client (`nats` /
//      `@nats-io`) and is NOT covered by the allowlist — a raw NATS emit that
//      should go through emit() (FR-8).
//   3. An ignored `emit()` / `emitRaw()` result — a bare call statement whose
//      Either is never consumed (fire-and-forget = silent dropped event;
//      SKP-001 #1 / T2.7).
//   4. `publishEnvelope` imported as a value from `@0xhoneyjar/events` in any
//      file outside the events package — the capability that bypasses schema
//      validation (FR-1 / events #255). Must go through emit() or be explicitly
//      allowlisted in publishEnvelope_allowlist.
//
// Teaching output (FR-ADOPT-6): each finding names the file:line, says whether
// it is NEW (un-allowlisted → a regression) or allowlisted (informational),
// links the doc, and names the fix command.
//
// **Tripwire scope (honest, not exhaustive).** Pure-text heuristics, no type
// info — mirrors the repo's tools/check-no-raw-*.sh philosophy. Accepted blind
// spots: a NATS client aliased through a non-`nats` re-export; `.publish` via a
// dynamically-built method name; an emit() consumed across statements. The
// type-level boundary (closure transport, package exports map) is the
// load-bearing fence; this scanner is a detection tripwire.
//
// Usage:
//   events-lint [--root <dir>] [--allowlist <path>] [--enforce] [--json]
//   exit 0 unless --enforce and a NEW (un-allowlisted) finding exists.
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const ROOT = opt("--root", process.cwd());
const ALLOWLIST_PATH = opt("--allowlist", join(ROOT, "packages/events/raw-nats-allowlist.yaml"));
const ENFORCE = args.includes("--enforce");
const JSON_OUT = args.includes("--json");

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "tests", "__tests__", "bin"]);
// The events package owns the raw transport; raw publish + internalPublish are legal there.
const EVENTS_PKG = `packages${sep}events${sep}src`;

function walk(dir, out = []) {
  let ents;
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out);
    } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".mts"))) {
      if (!e.name.endsWith(".d.ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
  }
  return out;
}

// Allowlisted site-ids carry a file path fragment before "::". A finding in a
// file whose path ends with that fragment is treated as known (informational).
// BB F4: parse allowlist ids at SITE granularity (`<file-fragment>::<marker>`)
// rather than collapsing to the file. A new raw .publish with a DIFFERENT subject
// added to an already-allowlisted file must NOT be silently blessed.
function loadAllowlist(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const entries = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*-\s+id:\s*"?([^"]+?)"?\s*$/);
    if (!m) continue;
    const id = m[1].trim();
    const idx = id.indexOf("::");
    if (idx < 0) continue;
    entries.push({ fileFrag: id.slice(0, idx), marker: id.slice(idx + 2) });
  }
  return entries;
}

const allowEntries = loadAllowlist(ALLOWLIST_PATH);

// site-granular: a finding is KNOWN only if BOTH the file AND the subject match an
// allowlist entry. `subject === null` means a computed/dynamic subject (no literal),
// which matches `computed*` markers. Disambiguated entries (`<subject>::<tag>` for
// a file emitting the same subject twice) match via the `<subject>::` prefix.
function isAllowlisted(relPath, subject) {
  const p = relPath.replace(/\\/g, "/");
  return allowEntries.some((e) => {
    if (!p.endsWith(e.fileFrag)) return false;
    if (subject === null) return e.marker.startsWith("computed");
    return e.marker === subject || e.marker.startsWith(`${subject}::`);
  });
}

const SUBJECT_LITERAL = /\.(?:nats|jetstream)\.publish\s*\(\s*["']([^"']+)["']/;

// =============================================================================
// publishEnvelope-bypass detection (FR-1 / events #255) — WHOLE-FILE, two-pass.
//
// The old detector matched `publishEnvelope` AND `from "@0xhoneyjar/events"` on
// the SAME line. FAGAN proved that trivially evaded: a multi-line (Prettier)
// import (F1) and a `import * as events` + `events.publishEnvelope()` member
// access (F2) both split the two tokens across lines → total miss. Its
// comment-skip was also insufficient → false positives on mentions inside
// comments and on type-only forms (F3). This rule alone moves to whole-file
// matching; the internalPublish / raw-nats-publish / unhandled-emit rules stay
// line-based below.
//
// A file is flagged IFF it imports a runnable `publishEnvelope` VALUE from
// `@0xhoneyjar/events`: a named value import (NOT `import type`, `export type`,
// or an inline `{ type publishEnvelope }`), OR a namespace import whose alias is
// then member-accessed as `.publishEnvelope`. Comments are stripped first so
// mentions inside `//…` / `/* … */` never match (and string contents are
// preserved, so a literal containing `//` is not mistaken for a comment).
// =============================================================================

// Strip line + block comments while PRESERVING byte offsets and newlines, so a
// char offset into the stripped text maps to the same line as the original.
// String-aware (single/double/template) so `//` or `/*` inside a string literal
// is NOT treated as a comment opener.
function stripComments(src) {
  let out = "";
  const n = src.length;
  let state = "code"; // code | line | block | sq | dq | tpl
  for (let i = 0; i < n; i++) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : "";
    if (state === "code") {
      if (c === "/" && d === "/") { state = "line"; out += "  "; i++; continue; }
      if (c === "/" && d === "*") { state = "block"; out += "  "; i++; continue; }
      if (c === "'") { state = "sq"; out += c; continue; }
      if (c === '"') { state = "dq"; out += c; continue; }
      if (c === "`") { state = "tpl"; out += c; continue; }
      out += c; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += c; continue; }
      out += " "; continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") { state = "code"; out += "  "; i++; continue; }
      out += c === "\n" ? "\n" : " "; continue;
    }
    // string states: copy verbatim, honor escapes, exit on the matching quote
    if (c === "\\") { out += c + (d || ""); i++; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
      state = "code";
    }
    out += c;
  }
  return out;
}

const lineAtOffset = (s, off) => {
  let line = 1;
  for (let k = 0; k < off && k < s.length; k++) if (s[k] === "\n") line++;
  return line;
};

// Matches an `import`/`export … from "@0xhoneyjar/events"` statement. The clause
// (group 2) is everything between the keyword and `from`; the inner negative
// lookahead `(?!\bfrom\b)` stops a non-greedy clause from spanning a PRIOR
// import's `from`, so a `publishEnvelope` binding from a DIFFERENT package can
// never be mis-attributed to the events import.
const EVENTS_IMPORT = /\b(import|export)\b((?:(?!\bfrom\b)[\s\S])*?)\bfrom\s*["']@0xhoneyjar\/events["']/g;

// Returns { line } for the first reachable publishEnvelope VALUE, or null.
function detectPublishEnvelopeBypass(stripped) {
  EVENTS_IMPORT.lastIndex = 0;
  let m;
  while ((m = EVENTS_IMPORT.exec(stripped)) !== null) {
    const full = m[0];
    const clause = m[2];
    // Statement-level type-only (`import type …` / `export type …`): no value.
    if (/^\s*type\b/.test(clause)) continue;

    // Namespace import: `* as ns` → reachable only if `ns.publishEnvelope` is used.
    const ns = clause.match(/\*\s+as\s+(\w+)/);
    if (ns) {
      const member = new RegExp(`\\b${ns[1]}\\s*\\.\\s*publishEnvelope\\b`);
      const mm = member.exec(stripped);
      if (mm) return { line: lineAtOffset(stripped, mm.index) };
      continue;
    }

    // Named bindings: `{ a, publishEnvelope, … }`. A `type ` prefix on the
    // specifier (inline type modifier) means the binding is NOT a runnable value.
    const brace = clause.match(/\{([\s\S]*)\}/);
    if (brace) {
      for (const spec of brace[1].split(",")) {
        const s = spec.trim();
        if (!s || /^type\b/.test(s)) continue;
        if (/^publishEnvelope\b/.test(s)) {
          const off = m.index + Math.max(0, full.indexOf("publishEnvelope"));
          return { line: lineAtOffset(stripped, off) };
        }
      }
    }
  }
  return null;
}

// Discriminate NATS from Redis/Rabbit/notifier by RECEIVER NAME, not imports:
// every NATS emit in this codebase publishes via `.nats.publish(` or
// `.jetstream.publish(`, while every carve-out uses `.client.` / `.redis.` /
// `.stateManager.` / `.channel.` / a bare `this.publish(`. This is the practical
// stand-in for type-discrimination (FR-ADOPT-4) without a typed linter. Tripwire
// blind spot: a NATS publisher named something else would be missed.
const NATS_PUBLISH = /\.(nats|jetstream)\.publish\s*\(/;
const INTERNAL_PUBLISH = /\binternalPublish\b/;
// A bare emit()/emitRaw() statement whose result is not bound/returned/voided.
const EMIT_CALL = /(^|[^.\w])(emit|emitRaw)\s*\(/;
const CONSUMED = /(=|return|void|await\s+\w[\w.]*\s*=|Either|const\s|let\s|\.then\(|\?\s)/;

const findings = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (rel.includes(EVENTS_PKG.replace(/\\/g, "/"))) continue; // events package is exempt
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    if (INTERNAL_PUBLISH.test(line) && /import|from/.test(line)) {
      findings.push({ file: rel, line: i + 1, kind: "internalPublish-import", allowlisted: false, text: trimmed });
    }
    if (NATS_PUBLISH.test(line)) {
      const sm = line.match(SUBJECT_LITERAL);
      const subject = sm ? sm[1] : null; // null = computed/dynamic subject
      findings.push({
        file: rel,
        line: i + 1,
        kind: "raw-nats-publish",
        allowlisted: isAllowlisted(rel, subject),
        subject,
        text: trimmed,
      });
    }
    // unhandled Either: a statement-position emit()/emitRaw() not obviously consumed.
    if (EMIT_CALL.test(line) && !CONSUMED.test(line) && !/function|interface|type\s|=>/.test(line)) {
      findings.push({ file: rel, line: i + 1, kind: "unhandled-emit-either", allowlisted: false, text: trimmed });
    }
  }

  // publishEnvelope-bypass (FR-1 / events #255): whole-file, comment-stripped,
  // two-pass — catches multi-line imports (F1) and namespace member access (F2)
  // the old line matcher missed, without the comment false-positives (F3).
  const pe = detectPublishEnvelopeBypass(stripComments(text));
  if (pe) {
    findings.push({
      file: rel,
      line: pe.line,
      kind: "publishEnvelope-bypass",
      allowlisted: isAllowlisted(rel, "publishEnvelope"),
      text: (lines[pe.line - 1] ?? "").trim(),
    });
  }
}

const newFindings = findings.filter((f) => !f.allowlisted);

if (JSON_OUT) {
  console.log(JSON.stringify({ findings, new: newFindings.length, enforced: ENFORCE }, null, 2));
} else {
  const DOC = "grimoires/loa/cycles/cycle-112-schema-emission-floor/sdd.md §5";
  const FIX = {
    "internalPublish-import":
      "internalPublish is a package-private capability — never import it. Use the cell's emit() (makeEmitter).",
    "raw-nats-publish":
      "raw NATS .publish bypasses the schema floor. Use emit(SchemaId, payload). New event? `freeside events:new-schema <name>`.",
    "unhandled-emit-either":
      "the emit()/emitRaw() result is a typed Either — handle it (branch on Either.isLeft). An ignored Left is a silent dropped event.",
    "publishEnvelope-bypass":
      "publishEnvelope skips schema validation. Use the cell's emit() (makeEmitter) — it " +
      "validates before signing. If a raw path is genuinely required, add an explicit " +
      "entry to publishEnvelope_allowlist in raw-nats-allowlist.yaml.",
  };
  if (findings.length === 0) {
    console.log("[events-lint] OK — no raw NATS emits, no capability leaks, no unhandled emit Eithers.");
  }
  for (const f of findings) {
    const tag = f.allowlisted ? "KNOWN (allowlisted)" : "NEW (regression)";
    const stream = f.allowlisted ? "::notice" : ENFORCE ? "::error" : "::warning";
    console.log(`${stream}::[events-lint] ${tag} ${f.kind} — ${f.file}:${f.line}`);
    console.log(`    ${f.text}`);
    console.log(`    fix: ${FIX[f.kind]}`);
    console.log(`    doc: ${DOC}`);
  }
  console.log(`[events-lint] ${findings.length} finding(s) · ${newFindings.length} NEW (un-allowlisted)`);
  if (newFindings.length > 0 && !ENFORCE) {
    console.log("[events-lint] REPORT-ONLY (cycle-112 S2 ramp) — not failing. Pass --enforce to fail-block (S5/T5.5).");
  }
}

process.exit(ENFORCE && newFindings.length > 0 ? 1 : 0);
