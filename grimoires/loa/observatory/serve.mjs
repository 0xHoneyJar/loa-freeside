#!/usr/bin/env node
// serve — the Observatory's live tail (spec step 4: real-time spectate).
//
//   node serve.mjs [--run .run/compose/<dir>] [--port 8787]
//
// Serves game.html + /level.json. /level.json re-folds the run dir through
// trace-gen on every poll (cheap: small files), so a /compose run executing in
// another terminal animates here within one poll interval. No deps, no build.
//
//   terminal A:  /compose … (a real run writing .run/compose/<id>/)
//   terminal B:  node grimoires/loa/observatory/serve.mjs --run .run/compose/<id>
//                open http://localhost:8787/game.html?auto=1
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const runDir = opt("run", null);
const port = Number(opt("port", 8787));
const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };

createServer((req, res) => {
  const url = new URL(req.url, `http://x`);
  try {
    if (url.pathname === "/level.json") {
      if (!runDir || !existsSync(runDir)) { res.writeHead(404); return res.end(JSON.stringify({ error: "no --run dir" })); }
      const audit = existsSync(".run/audit.jsonl") ? ["--audit", ".run/audit.jsonl"] : [];
      const invoke = existsSync(".run/model-invoke.jsonl") ? ["--invoke", ".run/model-invoke.jsonl"] : [];
      const out = execFileSync("node", [join(here, "trace-gen.mjs"), runDir, ...audit, ...invoke], { encoding: "utf8" });
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(out);
    }
    const f = join(here, url.pathname === "/" ? "game.html" : url.pathname.replace(/^\//, ""));
    if (!f.startsWith(here) || !existsSync(f)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[extname(f)] ?? "text/plain" });
    return res.end(readFileSync(f));
  } catch (e) { res.writeHead(500); res.end(String(e?.message ?? e)); }
}).listen(port, () => console.log(`observatory ▸ http://localhost:${port}/game.html${runDir ? `  (live tail: ${runDir})` : "  (baked level — pass --run for live)"}`));
