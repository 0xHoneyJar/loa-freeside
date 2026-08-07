#!/usr/bin/env node
/* Freeside Design System — zero-Node-dependency static server.
   The package has no npm dependencies. Interactive cards and templates use pinned
   browser runtimes; restricted or offline consumers must provide approved local
   copies as documented in README.md. Serving the files still requires http://
   rather than file://, which module scripts and fetch() require.

   Usage: node scripts/serve.js [root] [port]        default: . 4173 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

function listing(dir, urlPath) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  const rows = entries.map(e => {
    const href = path.posix.join(urlPath, e.name) + (e.isDirectory() ? '/' : '');
    return '<li><a href="' + href + '">' + e.name + (e.isDirectory() ? '/' : '') + '</a></li>';
  }).join('');
  return '<!doctype html><meta charset="utf-8"><title>' + urlPath + '</title>' +
    '<body style="font:14px/1.6 ui-monospace,monospace;padding:32px;background:#081F28;color:#F7F1E5">' +
    '<h1 style="font-size:15px;letter-spacing:.14em;text-transform:uppercase">' + urlPath + '</h1>' +
    '<ul style="list-style:none;padding:0">' + rows + '</ul>' +
    '<style>a{color:#66ADC6;text-decoration:none}a:hover{color:#C8705B}</style>';
}

http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end('bad url'); return; }

  // Never serve outside the chosen root, however the path is spelled.
  const target = path.resolve(root, '.' + urlPath);
  if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403).end('forbidden'); return; }

  let stat;
  try { stat = fs.statSync(target); } catch { res.writeHead(404).end('not found: ' + urlPath); return; }

  if (stat.isDirectory()) {
    const index = path.join(target, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      fs.createReadStream(index).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    res.end(listing(target, urlPath.endsWith('/') ? urlPath : urlPath + '/'));
    return;
  }

  res.writeHead(200, { 'content-type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}).listen(port, () => {
  console.log('Freeside Design System — serving ' + root);
  console.log('  http://localhost:' + port + '/');
});
