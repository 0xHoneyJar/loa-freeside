// trace-gen.test.mjs — sprite→construct identity binding (bug-20260613-fee9d9).
// The Observatory draws each room as a pixel character; the sprite is the room's
// `spr`. The bug: trace-gen assigned `spr` by POSITION (SPRS[i % len]), so on a
// real compose fold gecko rendered as the `noether` character. These tests prove
// the face follows IDENTITY, not run position. Run: `node --test trace-gen.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TRACE_GEN = join(here, "trace-gen.mjs");
const SPRITES = ["noether", "arcade", "proto", "gecko", "vocab", "easel", "khole", "artisan"];

// Build a minimal canonical compose run: one construct-handoff envelope per stage.
function fixtureRun(stages) {
  const dir = mkdtempSync(join(tmpdir(), "obs-fixture-"));
  mkdirSync(join(dir, "envelopes"));
  stages.forEach((s, i) => {
    const pkt = {
      construct_slug: s.slug, persona: s.slug.toUpperCase(), output_type: "Artifact",
      verdict: { summary: "did the thing" }, invocation_mode: "room", cycle_id: "test",
      stage_index: s.stage_index, gates_passed: [], gates_failed: [], output_refs: [], evidence: [],
    };
    writeFileSync(join(dir, "envelopes", `0${i + 1}.${s.slug}.handoff.json`), JSON.stringify(pkt));
  });
  writeFileSync(join(dir, "orchestrator.jsonl"),
    JSON.stringify({ event: "compose.start", run_id: "test-run", payload: { composition: "test" } }) + "\n");
  return dir;
}
const fold = dir => JSON.parse(execFileSync(process.execPath, [TRACE_GEN, dir], { encoding: "utf8" }));
const sprOf = (lvl, slug) => lvl.rooms.find(r => r.construct === slug)?.spr;

test("compose fold binds each room's sprite to its construct identity", () => {
  const lvl = fold(fixtureRun([{ slug: "gecko", stage_index: 1 }, { slug: "the-arcade", stage_index: 2 }]));
  assert.equal(sprOf(lvl, "gecko"), "gecko", "gecko must render as the gecko character, not positional SPRS[0]");
  assert.equal(sprOf(lvl, "the-arcade"), "arcade", "the-arcade must render as the arcade character");
});

test("sprite binding is identity-based, not positional (order does not change the face)", () => {
  // the-arcade FIRST: positional code gives the-arcade→noether, gecko→arcade — both wrong.
  const lvl = fold(fixtureRun([{ slug: "the-arcade", stage_index: 1 }, { slug: "gecko", stage_index: 2 }]));
  assert.equal(sprOf(lvl, "the-arcade"), "arcade");
  assert.equal(sprOf(lvl, "gecko"), "gecko");
});

test("unmapped construct: face follows identity not position (same face at different indices)", () => {
  const at1 = sprOf(fold(fixtureRun([{ slug: "mystery-x", stage_index: 1 }, { slug: "gecko", stage_index: 2 }])), "mystery-x");
  const at4 = sprOf(fold(fixtureRun([
    { slug: "gecko", stage_index: 1 }, { slug: "k-hole", stage_index: 2 },
    { slug: "artisan", stage_index: 3 }, { slug: "mystery-x", stage_index: 4 }])), "mystery-x");
  assert.equal(at1, at4, "unmapped construct must get the same face regardless of run position (identity hash, not SPRS[i])");
  assert.ok(SPRITES.includes(at1), "fallback must resolve to a real sprite");
});
