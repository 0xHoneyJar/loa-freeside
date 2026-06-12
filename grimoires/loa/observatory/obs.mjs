#!/usr/bin/env node
// obs — the Observatory's CLI (asson-shaped; veve.json sits beside this file).
//
//   obs sim   [--seed N --greed X --discipline Y --rooms N]   deterministic forward model → LevelData
//   obs fold  <run-dir> [--audit f --invoke f --enrage-s N]   fold a real compose run → LevelData
//   obs serve [--run dir --port N]                            serve game.html + live /level.json
//   obs selftest                                              prove the contract wall fires (red test)
//
// One distributable surface for any Loa consumer: produce a level (sim or real),
// open the game on it, or tail a live run. The producers are the law-bearers
// (obs-level/1, validated before emit); this router adds no semantics.
import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [verb, ...rest] = process.argv.slice(2);
const run = (script, args, opts = {}) => {
  try { execFileSync(process.execPath, [join(here, script), ...args], { stdio: "inherit", ...opts }); }
  catch (e) { process.exit(e.status ?? 1); } };

switch (verb) {
  case "sim": run("sim-gen.mjs", rest); break;
  case "fold": run("trace-gen.mjs", rest); break;
  case "selftest": run("trace-gen.mjs", ["--selftest"]); break;
  case "serve": {
    const child = spawn(process.execPath, [join(here, "serve.mjs"), ...rest], { stdio: "inherit" });
    child.on("exit", c => process.exit(c ?? 0)); break; }
  default:
    console.error("obs — the Observatory CLI (asson-shaped)\n" +
      "  obs sim   [--seed N --greed X --discipline Y --rooms N]\n" +
      "  obs fold  <run-dir> [--audit f --invoke f --enrage-s N] [--live] [--url]\n" +
      "  obs serve [--run dir --port N]\n" +
      "  obs selftest");
    process.exit(verb ? 2 : 0);
}
