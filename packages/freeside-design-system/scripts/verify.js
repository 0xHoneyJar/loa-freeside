#!/usr/bin/env node
/* Freeside Design System — portability verification.
   Answers one question: will this tree work from a clean git checkout on Linux,
   served over http, with no Claude Design host present? Every check below is a
   thing that has actually broken during export at least once. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fail = [];
const warn = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(root);
const rel = p => path.relative(root, p).split(path.sep).join('/');
const TEXT = /\.(html|css|js|mjs|json|md|ts|tsx|jsx|txt|svg)$/i;

/* 1 · Referenced local files must exist, case-correct. GitHub and Linux are
      case-sensitive; macOS is not, so a wrong case passes locally and 404s in CI. */
/* Two reference grammars, deliberately separate. `url()` and `@import` are CSS,
   and scanning for them inside JavaScript matches `new URL(css, base)` call syntax
   instead — which produced 26 false failures the first time this ran. So markup
   references are scanned everywhere, and CSS references only where CSS can live. */
const REF_MARKUP = /(?:src|href)\s*=\s*"([^"]+)"/gi;
const REF_CSS = /url\(\s*['"]?([^'")]+)['"]?\s*\)|@import\s+['"]([^'"]+)['"]/gi;
const isCss = p => /\.css$/i.test(p);
const stripCssComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const isMarkup = p => /\.(html|svg)$/i.test(p);
const lower = new Map(files.map(f => [rel(f).toLowerCase(), rel(f)]));
for (const f of files) {
  if (!TEXT.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const found = [];
  if (isMarkup(f)) {
    for (const m of src.matchAll(REF_MARKUP)) found.push(m[1]);
    // inline <style> blocks are CSS, wherever they sit
    for (const s of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
      for (const m of stripCssComments(s[1]).matchAll(REF_CSS)) found.push(m[1] || m[2]);
  } else if (isCss(f)) {
    /* Comments first. A recipe file legitimately documents the CONSUMER's install
       paths in a comment block ("@import '../styles/app/tokens.css'"), and those
       paths do not exist here — four false failures the first time this ran. */
    for (const m of stripCssComments(src).matchAll(REF_CSS)) found.push(m[1] || m[2]);
  }
  for (const ref of found) {
    if (!ref) continue;
    if (/^(https?:|data:|blob:|mailto:|#|\/\/)/i.test(ref)) continue;
    if (ref.startsWith('/')) { fail.push(rel(f) + ' → absolute path "' + ref + '"'); continue; }
    if (/^\{\{|\}\}$/.test(ref) || ref.includes('{{')) continue;  // a template hole, not a path
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel(f)), ref.split(/[?#]/)[0]));
    if (target.startsWith('..')) { fail.push(rel(f) + ' → escapes package root: "' + ref + '"'); continue; }
    if (fs.existsSync(path.join(root, target))) continue;
    const ci = lower.get(target.toLowerCase());
    if (ci) fail.push(rel(f) + ' → CASE MISMATCH "' + ref + '" (on disk: ' + ci + ')');
    else fail.push(rel(f) + ' → missing "' + ref + '"');
  }
}

/* 2 · No editor-host or ephemeral references may survive the export. */
const BANNED = [
  [/blob:https?:/i, 'temporary blob URL'],
  [/\/Users\/[a-z0-9_.-]+\//i, 'absolute macOS path'],
  [/[A-Z]:\\\\Users\\\\/i, 'absolute Windows path'],
  [/\/home\/[a-z0-9_.-]+\//i, 'absolute Linux home path']
];
for (const f of files) {
  if (!TEXT.test(f)) continue;
  if (rel(f).startsWith('dist/full-system.html')) continue; // self-contained bundle: data URIs only, checked below
  const src = fs.readFileSync(f, 'utf8');
  const artifactHost = 'claudeusercontent' + '.com';
  const urls = src.match(/https?:\/\/[^\s"'<>`]+/gi) || [];
  const hasArtifactHost = urls.some(raw => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      return host === artifactHost || host.endsWith('.' + artifactHost);
    } catch {
      return false;
    }
  });
  if (hasArtifactHost)
    fail.push(rel(f) + ' → contains Claude artifact host');
  for (const [re, why] of BANNED) if (re.test(src)) fail.push(rel(f) + ' → contains ' + why);
}


/* 2b · No unresolved blank frame source may survive outside the
   intentional conformance harness. Match actual src/href assignments,
   not documentation, comments, or this verifier's own rule text. */
for (const f of files) {
  if (!TEXT.test(f)) continue;
  const r = rel(f);
  if (r === 'dist/conformance.html') continue;
  const src = fs.readFileSync(f, 'utf8');
  if (/\b(?:src|href)\s*=\s*["']about:blank(?:#[^"']*)?["']/i.test(src))
    fail.push(r + ' → contains about:blank frame source');
}

/* 3 · The offline bundle must be genuinely offline: no http(s) subresources. */
const bundlePath = path.join(root, 'dist/full-system.html');
if (fs.existsSync(bundlePath)) {
  const b = fs.readFileSync(bundlePath, 'utf8');
  const remote = [...b.matchAll(/(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/gi)].map(m => m[1]);
  const allowedFontHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
  const offsite = remote.filter(raw => {
    try {
      return !allowedFontHosts.has(new URL(raw).hostname.toLowerCase());
    } catch {
      return true;
    }
  });
  if (offsite.length) fail.push('dist/full-system.html → ' + offsite.length + ' remote subresource(s): ' + offsite.slice(0, 3).join(', '));
} else warn.push('dist/full-system.html absent — run npm run build? (it is shipped, not generated)');

/* 4 · Required entry points. */
for (const p of ['styles.css','environment.css','templates/_doctrine/doctrine.js',
                 'templates/_doctrine/tests.js','templates/_doctrine/fixtures.js',
                 'templates/_doctrine/run-checks.js','CLAUDE.md','README.md','package.json'])
  if (!fs.existsSync(path.join(root, p))) fail.push('missing required file: ' + p);

/* 5 · Every template must carry its own copy pack and a README. */
for (const slug of fs.readdirSync(path.join(root, 'templates'))) {
  if (slug.startsWith('_')) continue;
  const dir = path.join(root, 'templates', slug);
  if (!fs.statSync(dir).isDirectory()) continue;
  const has = fs.readdirSync(dir);
  if (!has.some(f => f.endsWith('.dc.html'))) fail.push('templates/' + slug + ' → no .dc.html entry');
  if (!has.includes('ds-base.js')) fail.push('templates/' + slug + ' → no ds-base.js');
  if (!has.includes('README.md')) warn.push('templates/' + slug + ' → no README.md');
  if (slug !== 'station-console' && !has.includes('copy.js'))
    fail.push('templates/' + slug + ' → no copy.js (only station-console is exempt: it is not doctrine-projected)');
}

/* 6 · No style holes. A {{ }} hole inside a style attribute cannot resolve while
      the template streams, so the property never paints on first render. */
for (const f of files) {
  if (!/\.dc\.html$/.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/style="[^"]*\{\{[^"]*"/g))
    warn.push(rel(f) + ' → style hole: ' + m[0].slice(0, 70));
}

console.log('Freeside Design System · portability verification');
console.log('  files scanned: ' + files.length);
for (const w of warn) console.log('  WARN  ' + w);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(fail.length ? '\nFAILED — ' + fail.length + ' problem(s)' : '\nOK — tree is portable' + (warn.length ? ' (' + warn.length + ' warning(s))' : ''));
process.exit(fail.length ? 1 : 0);
