#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// hook-wiring-doctor — verify WIRING, not existence, across the operator estate.
//
// The geometry-fidelity audit (2026-06-10) found the recurring honesty gap is a
// hook that EXISTS on disk but is not WIRED into the live settings — the scanner
// that only checks existsSync is blind to it. It also found a live defect the
// operator estate had no sensor for: a command duplicated 4x in PreToolUse
// (a settings-merge idempotency bug). This is that missing sensor, applied to
// the EFFECTIVE MERGED hook set (~/.claude + repo .claude + any *.local.json).
//
// Three checks (the cure shape "verify wiring not existence"):
//   DUP     — the same command appears >1x under one event (merge idempotency bug)
//   GHOST   — a wired command references a script path that does NOT resolve
//   UNWIRED — a hook script present on disk is referenced by NO merged settings hook
//
// Usage:  node hook-wiring-doctor.mjs [repoDir]   (repoDir defaults to cwd)
//         --json
// Exit 1 on DUP or GHOST (real defects). UNWIRED is reported but does not fail
// (a script may be intentionally parked) unless --strict.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const STRICT = args.includes('--strict');
const repoDir = resolve(args.find((a) => !a.startsWith('--')) || process.cwd());
const HOME = homedir();

// the precedence lanes Claude Code merges (global → repo → local), all optional
const settingsFiles = [
  join(HOME, '.claude', 'settings.json'),
  join(HOME, '.claude', 'settings.local.json'),
  join(repoDir, '.claude', 'settings.json'),
  join(repoDir, '.claude', 'settings.local.json'),
].filter(existsSync);

// collect (event, command, sourceFile) for every wired hook
const wired = [];
for (const f of settingsFiles) {
  let s;
  try { s = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { wired.push({ event: '(parse-error)', cmd: f + ': ' + e.message, src: f }); continue; }
  const h = s.hooks || {};
  for (const ev of Object.keys(h)) for (const m of (h[ev] || [])) for (const hk of (m.hooks || []))
    if (hk.command) wired.push({ event: ev, cmd: hk.command, src: f.replace(HOME, '~') });
}

// extract referenced script paths from a command string (heuristic: path-like tokens ending in a script ext)
const scriptRe = /((?:~|\/|\.{0,2}\/|[\w.-]+\/)[\w./~-]*\.(?:sh|mjs|js|py))/g;
const resolvePath = (p) => p.startsWith('~') ? join(HOME, p.slice(1)) : (p.startsWith('/') ? p : join(repoDir, p));

const findings = [];

// 1. DUP — identical command repeated within one event
const byEvent = {};
for (const w of wired) (byEvent[w.event] ||= []).push(w.cmd.trim());
for (const ev of Object.keys(byEvent)) {
  const counts = {};
  for (const c of byEvent[ev]) counts[c] = (counts[c] || 0) + 1;
  for (const c of Object.keys(counts)) if (counts[c] > 1)
    findings.push({ sev: 'DUP', event: ev, n: counts[c], detail: c.slice(0, 90) });
}

// 2. GHOST — a wired command references a script that does not resolve
const referenced = new Set();
for (const w of wired) {
  const paths = w.cmd.match(scriptRe) || [];
  for (const p of paths) {
    const abs = resolvePath(p);
    referenced.add(abs);
    if (!existsSync(abs)) findings.push({ sev: 'GHOST', event: w.event, detail: `${p} → ${abs.replace(HOME, '~')} (ABSENT; wired in ${w.src})` });
  }
}

// 3. UNWIRED — hook scripts on disk referenced by no merged settings hook
const hookDirs = [join(HOME, '.claude', 'hooks'), join(repoDir, '.claude', 'hooks')].filter(existsSync);
const walk = (d) => { let out = []; for (const e of readdirSync(d)) { const p = join(d, e); const st = statSync(p); if (st.isDirectory()) out = out.concat(walk(p)); else if (/\.(sh|mjs)$/.test(e)) out.push(p); } return out; };
const onDisk = hookDirs.flatMap(walk);
for (const p of onDisk) {
  // a script is "wired" if its absolute path (or basename) is referenced by any command
  const base = p.split('/').pop();
  const isRef = referenced.has(p) || wired.some((w) => w.cmd.includes(base));
  if (isRef) continue;
  // a safety/ or compliance/ hook unwired is a real GAP (a purpose-built gate that never fires);
  // anything else (tmux status, sound notifiers, utilities) is parked-by-design, info-only.
  const isGate = /\/(safety|compliance)\//.test(p);
  findings.push({ sev: isGate ? 'UNWIRED-GAP' : 'UNWIRED-PARKED', event: '—', detail: `${p.replace(HOME, '~')}${isGate ? ' (a GATE that never fires)' : ' (parked utility)'}` });
}

const dup = findings.filter((f) => f.sev === 'DUP');
const ghost = findings.filter((f) => f.sev === 'GHOST');
const gap = findings.filter((f) => f.sev === 'UNWIRED-GAP');
const parked = findings.filter((f) => f.sev === 'UNWIRED-PARKED');
const fail = dup.length + ghost.length + (STRICT ? gap.length : 0);

if (JSON_OUT) console.log(JSON.stringify({ settingsFiles: settingsFiles.map((f) => f.replace(HOME, '~')), wired: wired.length, onDisk: onDisk.length, dup: dup.length, ghost: ghost.length, unwired_gap: gap.length, unwired_parked: parked.length, findings }, null, 2));
else {
  console.log(`\n∴ HOOK-WIRING DOCTOR — effective merged hook set (${settingsFiles.length} settings file(s), ${wired.length} wired hooks, ${onDisk.length} scripts on disk)\n`);
  if (!findings.length) console.log('  ✓ clean — no duplicates, no ghosts, no unwired gates.');
  else {
    for (const f of dup) console.log(`  [DUP]      ${f.event}: x${f.n}  ${f.detail}`);
    for (const f of ghost) console.log(`  [GHOST]    ${f.event}: ${f.detail}`);
    for (const f of gap) console.log(`  [GAP]      ${f.detail}`);
    if (parked.length) console.log(`  [parked]   ${parked.length} unwired utility script(s) (info — not gates): ${parked.map((f) => f.detail.split('/').pop().replace(/ .*/, '')).join(', ')}`);
    console.log(`\n  DUP/GHOST = real defects (merge bug / runtime failure). GAP = a purpose-built gate that never fires. parked = utilities, by design.`);
  }
}
process.exit(fail > 0 ? 1 : 0);
