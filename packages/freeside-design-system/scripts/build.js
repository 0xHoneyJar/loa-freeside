#!/usr/bin/env node
/* Freeside Design System — build.
   There is nothing to compile: the cards and templates are plain HTML. What this
   generates is the two things a checkout cannot have in source without going
   stale — dist/index.html (a real index of what exists on disk) and
   dist/manifest.json (the machine-readable inventory). Both are derived by
   READING the tree, so they cannot drift from it. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const listDir = p => { try { return fs.readdirSync(path.join(root, p)); } catch { return []; } };

/* ── TOKENS ─────────────────────────────────────────────────────────────── */
const tokenFiles = listDir('tokens').filter(f => f.endsWith('.css'));
const tokens = {};
for (const f of tokenFiles) {
  const names = [...read('tokens/' + f).matchAll(/(--fs-[a-z0-9-]+)\s*:/gi)].map(m => m[1]);
  tokens[f] = [...new Set(names)];
}
const envTokens = [...new Set([...read('environment.css').matchAll(/(--fs-env-[a-z0-9-]+)\s*:/gi)].map(m => m[1]))];
const tokenTotal = new Set([...Object.values(tokens).flat(), ...envTokens]).size;

/* ── COMPONENTS ─────────────────────────────────────────────────────────── */
const components = [];
for (const group of listDir('components')) {
  for (const f of listDir('components/' + group)) {
    if (!f.endsWith('.d.ts')) continue;
    const name = f.replace(/\.d\.ts$/, '');
    const impl = ['jsx', 'tsx'].map(e => 'components/' + group + '/' + name + '.' + e)
      .find(p => fs.existsSync(path.join(root, p)));
    components.push({ name, group, types: 'components/' + group + '/' + f, impl: impl || null,
      docs: fs.existsSync(path.join(root, 'components/' + group + '/' + name + '.prompt.md'))
        ? 'components/' + group + '/' + name + '.prompt.md' : null });
  }
}

/* ── TEMPLATES ──────────────────────────────────────────────────────────── */
const templates = [];
for (const slug of listDir('templates')) {
  if (slug.startsWith('_')) continue;
  const files = listDir('templates/' + slug);
  const entry = files.find(f => f.endsWith('.dc.html'));
  if (!entry) continue;
  const src = read('templates/' + slug + '/' + entry);
  const m = src.match(/@template name="([^"]*)"\s+description="([^"]*)"/);
  templates.push({
    slug, entry: 'templates/' + slug + '/' + entry,
    name: m ? m[1] : slug, description: m ? m[2] : '',
    copyPack: files.includes('copy.js') ? 'templates/' + slug + '/copy.js' : null,
    checks: files.includes('checks.js') ? 'templates/' + slug + '/checks.js' : null,
    printCopy: fs.existsSync(path.join(root, 'templates/_print/' + entry)) ? 'templates/_print/' + entry : null,
    files: files.filter(f => !f.startsWith('.'))
  });
}

/* ── COPY PACKS + FRAGMENTS ─────────────────────────────────────────────── */
const packs = [];
for (const t of templates) {
  if (!t.copyPack) continue;
  const src = read(t.copyPack);
  const id = (src.match(/registerPack\(\{\s*[\s\S]{0,200}?id:\s*'([^']+)'/) || [])[1] || t.slug;
  const catalogueVar = src.match(/\bvar\s+CATALOGUE\s*=\s*\{([\s\S]*?)\n\s{2}\};/);
  const catalogueInline = src.match(/catalogue:\s*\{([\s\S]*?)\n\s{2}\}/);
  const catalogueBody = catalogueVar
    ? catalogueVar[1]
    : catalogueInline
      ? catalogueInline[1]
      : '';
  const frags = [...catalogueBody.matchAll(/^\s*['"]([^'"]+)['"]\s*:/gm)].map(m => m[1]);
  packs.push({ id, file: t.copyPack, template: t.slug, fragments: frags.length });
}

/* ── CARDS ──────────────────────────────────────────────────────────────── */
const cards = [];
for (const f of listDir('cards')) {
  if (!f.endsWith('.html')) continue;
  const head = read('cards/' + f).slice(0, 400);
  const m = head.match(/@dsCard\s+group="([^"]*)"\s+viewport="([^"]*)"\s+name="([^"]*)"(?:\s+subtitle="([^"]*)")?/);
  cards.push({ file: 'cards/' + f, group: m ? m[1] : null, viewport: m ? m[2] : null,
    name: m ? m[3] : f, subtitle: m ? (m[4] || '') : '' });
}

/* ── ASSETS ─────────────────────────────────────────────────────────────── */
const assets = listDir('assets').map(f => ({ file: 'assets/' + f,
  bytes: fs.statSync(path.join(root, 'assets', f)).size }));

const manifest = {
  name: '@freeside/design-system',
  version: JSON.parse(read('package.json')).version,
  generatedAt: new Date().toISOString(),
  entry: { css: 'styles.css', environment: 'environment.css', doctrine: 'templates/_doctrine/doctrine.js' },
  counts: {
    tokens: tokenTotal, components: components.length, templates: templates.length,
    copyPacks: packs.length, fragments: packs.reduce((n, p) => n + p.fragments, 0),
    cards: cards.length, assets: assets.length
  },
  tokens, environmentTokens: envTokens, components, templates, copyPacks: packs, cards, assets
};

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

/* ── INDEX ──────────────────────────────────────────────────────────────── */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const byGroup = {};
for (const c of cards) (byGroup[c.group || 'Other'] = byGroup[c.group || 'Other'] || []).push(c);

const section = (title, body) =>
  '<section><h2>' + esc(title) + '</h2>' + body + '</section>';
const link = (href, label, note) =>
  '<li><a href="' + esc(href) + '">' + esc(label) + '</a>' +
  (note ? '<span class="n">' + esc(note) + '</span>' : '') + '</li>';

const html = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Freeside Design System \u00b7 v' + manifest.version + '</title>' +
  '<link rel="stylesheet" href="../styles.css">' +
  '<style>' +
  '*{box-sizing:border-box;margin:0;padding:0}' +
  'body{background:var(--fs-deep-space-ink);color:var(--fs-lado-sunlight);font-family:var(--fs-font-body);font-size:15px;line-height:1.6;padding:64px 48px 96px;max-width:1100px;margin:0 auto;font-variant-numeric:tabular-nums}' +
  '.wm{font-family:var(--fs-font-display);font-size:34px;letter-spacing:.14em;line-height:1}' +
  '.lede{max-width:70ch;color:rgba(247,241,229,.72);margin-top:20px}' +
  '.counts{display:flex;flex-wrap:wrap;gap:0 40px;margin:36px 0 8px;padding:20px 0;border-top:1px solid rgba(247,241,229,.18);border-bottom:1px solid rgba(247,241,229,.18)}' +
  '.counts div{display:flex;flex-direction:column;gap:4px}' +
  '.counts b{font-size:26px;font-weight:600}' +
  '.k{font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:rgba(247,241,229,.5)}' +
  'section{margin-top:48px}' +
  'h2{font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:rgba(247,241,229,.5);padding-bottom:12px;border-bottom:1px solid rgba(247,241,229,.14)}' +
  'ul{list-style:none;margin-top:4px}' +
  'li{padding:11px 0;border-bottom:1px solid rgba(247,241,229,.08);display:flex;gap:16px;align-items:baseline}' +
  'a{color:var(--fs-accent-2);text-decoration:none}a:hover{color:var(--fs-accent-1)}' +
  '.n{margin-left:auto;text-align:right;font-size:12.5px;color:rgba(247,241,229,.44);max-width:62ch}' +
  '.g{display:grid;grid-template-columns:1fr 1fr;gap:0 48px}' +
  '</style></head><body>' +
  '<div class="wm">FREESIDE</div>' +
  '<p class="lede">Design system source of truth. One underlying truth about the resort, disclosed at four precisions \u2014 Terrace, Atrium, Service, Ledger. Every user-facing string is projected through the Exposure doctrine rather than written into a template.</p>' +
  '<div class="counts">' +
  Object.entries(manifest.counts).map(([k, v]) =>
    '<div><b>' + v + '</b><span class="k">' + esc(k.replace(/([A-Z])/g, ' $1')) + '</span></div>').join('') +
  '</div>' +
  section('Templates', '<ul>' + templates.map(t =>
    link('../' + t.entry, t.name, t.description)).join('') + '</ul>') +
  Object.keys(byGroup).sort().map(g =>
    section('Cards \u00b7 ' + g, '<ul>' + byGroup[g].map(c =>
      link('../' + c.file, c.name, c.subtitle)).join('') + '</ul>')).join('') +
  section('Components', '<div class="g"><ul>' + components.map(c =>
    link('../' + (c.impl || c.types), c.name, c.group)).join('') + '</ul></div>') +
  section('Whole system', '<ul>' +
    link('full-system.html', 'The Whole System, on One Paper', 'every template and card in one printable document') +
    link('conformance.html', 'Conformance report', 'the audit, standalone and offline') +
    link('manifest.json', 'manifest.json', 'machine-readable inventory') +
    link('../retrofit/retrofit.card.html', 'Retrofit recipe', 'adopting Freeside colour in a repo that already has tokens') +
    '</ul>') +
  section('Documentation', '<ul>' +
    link('../README.md', 'README', 'what this is, how to run it, how to consume it') +
    link('../CLAUDE.md', 'CLAUDE.md', 'implementation rules for Claude Code') +
    link('../MANIFEST.md', 'MANIFEST', 'every file, purpose, source vs generated') +
    link('../KNOWN-GAPS.md', 'KNOWN-GAPS', 'what is deliberately unfinished') +
    link('../REPO-INTEGRATION.md', 'REPO-INTEGRATION', 'where this goes in loa-freeside') +
    '</ul>') +
  '</body></html>\n';

fs.writeFileSync(path.join(dist, 'index.html'), html);

console.log('built dist/index.html + dist/manifest.json');
for (const [k, v] of Object.entries(manifest.counts)) console.log('  ' + k.padEnd(12) + v);
