---
name: sweep-bonfire
description: "Walk the operator's bonfire — local working copies of authored constructs. Classify each by lifecycle glyph (seed/hot/warm/crystallized/cooling/ghost) and emit to the wall. Surface; never decide."
allowed-tools: [Bash, Read, Write, Edit]
user-invocable: true
---

# Sweep-Bonfire — Walk the Operator's Stalls

## Purpose

The `patrol` skill watches the constructs.network through its public API — the bazaar at altitude. This skill walks the *bonfire*: the operator's local working copies of constructs they author. Same eye, different altitude.

The patrol's job is reading the network. The sweep's job is reading what's about to *enter* the network — work in progress, branches not yet landed, charters not yet planted, stalls cooling because the operator forgot they exist.

## Invocation

```bash
/sweep-bonfire                              # default: ~/bonfire/* → ~/bonfire/WALL.md
/sweep-bonfire --root <path>                # alternative bonfire location
/sweep-bonfire --wall <path>                # alternative wall location
/sweep-bonfire --dry-run                    # print classification, don't write
/sweep-bonfire --json                       # machine-readable classification (no wall write)
```

## Lifecycle glyphs

The state vocabulary the sweep emits. Ghost is the only forbidden state — every other lane is a valid life event.

| glyph | state | who decides | signal |
|---|---|---|---|
| 🌱 | seed | operator | construct.yaml or CHARTER.md exists, no .git |
| 🟢 | hot | observed | clean tree, push within 24h |
| 🟡 | warm | observed | dirty tree, OR unpushed within 7d, OR active feature branch |
| 🔵 | crystallized | operator-declared | settled at rest, no work needed |
| 🟠 | cooling | observed | unpushed work 7-30d, OR dirty tree >7d |
| ♻︎ | absorbing | operator-declared | being merged into another construct |
| ⚫ | archived | operator-declared | formally retired with reason |
| 🔴 | ghost | forbidden | unpushed >30d with no declared state — surface; operator picks a lane |

Operator-declared states sit in the construct's `construct.yaml` under `lifecycle:`. If present, the sweep honors it over the observed default — observation never overrides intent.

## Classification logic

For each `<root>/<dir>`:

1. **Resolve type**
   - Has `.git/` → git-repo path
   - Has `construct.yaml` or `CHARTER.md` but no `.git/` → seed path
   - Neither → not a stall; skip

2. **Read operator declaration** (if `construct.yaml::lifecycle` is set: archived/crystallized/absorbing → honor it, append note)

3. **Otherwise observe:**

```
no_git + (construct.yaml OR CHARTER.md)          → 🌱 seed
clean_tree + clean_remote + push_age < 24h       → 🟢 hot
dirty_tree                                       → 🟡 warm (note: N dirty files)
clean_tree + unpushed_count > 0, push_age < 7d   → 🟡 warm (N unpushed, age)
clean_tree + unpushed_count > 0, 7d <= age <= 30d → 🟠 cooling
clean_tree + unpushed_count > 0, age > 30d       → 🔴 ghost
clean_tree + clean_remote + last_commit > 30d    → 🔵 crystallized (heuristic default)
on_feature_branch (not main/master/default)      → existing glyph + branch-fatigue note if branch_age > 7d
```

4. **Emit**
   - --dry-run: print to stdout, no writes
   - --json: print JSON to stdout, no writes
   - default: insert a sweep block at the top of the wall (after the header), atomically (mktemp + mv)

## Wall format emitted

```markdown
## YYYY-MM-DD — sweep — <trigger>

| stall | state | note |
|---|---|---|
| construct-X | 🟢 hot | clean, last push 2h ago |
| construct-Y | 🟠 cooling | 1 unpushed (12d), dirty tree |
| construct-Z | 🌱 seed | charter from 2026-05-19, not yet planted |
```

## Workflow

1. **Resolve config**
   - root = arg `--root` OR `$BONFIRE_ROOT` OR `~/bonfire`
   - wall = arg `--wall` OR `$BONFIRE_WALL` OR `<root>/WALL.md`
   - dry_run, json from argv

2. **Walk** `<root>/*` — each subdir is a candidate stall. Resolve type per above.

3. **Classify** each stall by the rules above. Read `construct.yaml::lifecycle` if present.

4. **Emit**
   - --json: marshal classification list to JSON, print, exit
   - --dry-run: print table to stdout, exit
   - default: read `<wall>`, insert new block above the most-recent `## YYYY-MM-DD` header, write atomically

5. **Summary line** to stderr: `sweep: N stalls observed (G hot, W warm, C cooling, K ghost) → <wall>`

## Anti-patterns

- **NEVER push detected dirty work.** The sweep observes; it does not act. Operator landing is a separate move.
- **NEVER reclassify operator-declared states.** If `construct.yaml::lifecycle: crystallized` is set, the sweep notes it; it does not promote/demote.
- **NEVER enter operator's home dir beyond `<wall>`.** The wall is the only write surface.
- **NEVER extrapolate to ghost without checking remote.** A 30-day-old branch with the work already pushed upstream is crystallized, not ghost.
- **NEVER write to the wall in --dry-run or --json mode.** Both modes are read-only.

## Trust boundary

| Action | Permission |
|---|---|
| Read `<root>/*/.git`, construct.yaml, CHARTER.md | yes |
| Write `<wall>` (default ~/bonfire/WALL.md) | yes |
| `git push`, `git commit`, mutate construct sources | **NEVER** |
| Open PRs, create branches, fetch from remote | **NEVER** |

## Composes with

- **`patrol`** (sibling skill) — the network-API observer at the bazaar altitude. The sweep is the local-working-copy observer at the bonfire altitude. Together they cover both ends of the construct lifecycle.
- **`auditing-cluster-cells`** (construct-freeside) — for sweeps over a cluster of installed-and-running buildings rather than a bonfire of authored constructs. Same shape, different scope.
- **`coordinating-cross-repo`** (construct-freeside) — execution surface for *acting on* what the sweep observes. The sweep surfaces; the coordinator dispatches.

## Why this exists

Operators forget. A construct sitting unpushed for 4 weeks is not a problem of operator discipline — it's a problem of the system not surfacing it. The bonfire's job is to never let a stall become ghost without the operator hearing about it first.

The reward function this skill optimizes: legibility of state across all operator-authored constructs. Ghost is the only forbidden state. Every other glyph is a valid lifecycle phase, including "nothing happening" (🔵 crystallized) — because the world changes too quickly for any state to be permanent, and resting is part of how organisms survive.
