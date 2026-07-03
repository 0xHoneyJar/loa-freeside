# INJECTIONS — broken bundle

Base: an exact copy of the `gecko` bundle (slug `gecko`, v0.1.0). Exactly three
violations were injected, each targeting a distinct rubric check. Everything else
is byte-identical to gecko in intent.

## (a) write / agent conflict → fails check 4

**File:** `SKILL.md` (and mirrored in `skills/observe/SKILL.md`).
The `observe` skill already declares `allowed-tools: [Bash, Read, Grep, Glob, Write, Edit]`
(write-capable). Injected `agent: Explore` into the frontmatter. `Explore` is a
read-only agent type (excludes Write/Edit/NotebookEdit), so the skill produces
output and silently drops it — the #553 write/agent conflict.

```diff
 user-invocable: true
+agent: Explore
 ---
```

## (b) invented model_tier → fails check 3

**File:** `manifest.json`.
`capabilities.model_tier` changed `opus` → `quantum`. `quantum` is not in the SoT
tier vocabulary {cheap, mid, tiny, max, opus, sonnet, haiku}. The manifest still
parses (check 1 PASS) — only the tier-vocabulary check fails.

```diff
-    "model_tier": "opus",
+    "model_tier": "quantum",
```

## (c) tampered genome link → fails check 8

**File:** `genome.jsonl`.
gecko ships **no** in-repo LEARNINGS.jsonl genome chain, so a valid 2-link chain
was fabricated (same as the clean gecko bundle), then link 1's `payload.learning`
was mutated **after** its `genome_hash` was minted. The stored `genome_hash` no
longer recomputes over the mutated body, and link 2's `parent_hash` now points at
a hash no member reproduces — the chain fails to verify.

- link 1 stored `genome_hash`: `e1ddc8750f2c09aa…` (minted over the original body)
- link 1 body now reads: `"TAMPERED: gating is fine actually"`
- recompute(link1 body) ≠ stored → chain BROKEN

Verified by the builder: `genome_ok = False — ['link 1: stored genome_hash != recompute']`.

## Net effect

Fails checks **3, 4, 8**. Checks 1, 2, 5, 6, 7, 9 still pass (content_hash and
proof-of-run were recomputed over the injected content, so check 9 stays valid).

**Expected score: 6/9.**
