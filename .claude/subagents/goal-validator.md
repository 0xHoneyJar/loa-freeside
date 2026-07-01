---
name: goal-validator
version: 1.1.0
description: Verify PRD goals are achieved by re-deriving observable state (never worker self-report)
context: fork
agent: Explore
triggers:
  - after: implementing-tasks
  - before: reviewing-code (final sprint only)
  - command: /validate goals
severity_levels:
  - GOAL_ACHIEVED
  - GOAL_AT_RISK
  - GOAL_BLOCKED
output_path: grimoires/loa/a2a/subagent-reports/goal-validation-{date}.md
---

# Goal Validator

<objective>
Verify that sprint implementation contributes to PRD goal achievement.
For final sprint, verify all goals are achieved end-to-end.
</objective>

## Workflow

1. Load PRD from `grimoires/loa/prd.md`
2. Extract goals with IDs (G-1, G-2, etc.)
3. Load sprint plan from `grimoires/loa/sprint.md` — for the goal→criterion MAPPING only,
   never for completion state (a checked box is a worker claim, not evidence)
4. For each goal:
   a. Find contributing tasks + acceptance criteria from Appendix C
   b. CRITERION-ADEQUACY CHECK: the criteria are WORKER-AUTHORED — verify they jointly
      entail the PRD goal's own Measurement/Validation column (extracted in step 2).
      If the sprint's criteria are narrower or reworded relative to the PRD metric,
      mark the goal AT_RISK with a criterion-drift note; re-deriving a favorably-worded
      predicate would just reproduce the self-report blind spot one level up
   c. Re-derive each acceptance criterion from observable state (§Acceptance-Criterion Re-Derivation)
   d. Trace integration producer→consumer in the actual tree (§Integration Gap Detection — primary evidence)
5. Generate validation report with per-criterion evidence (command run + exit code, or tree object inspected)
6. Return verdict

> **The evidence rule (v1.1.0, bead arrakis-goal-validator-self-report-284m):** this
> validator's verdict rests ONLY on state it re-derived itself, this invocation. It never
> treats worker-authored status — sprint checkmarks, review reports, NOTES status
> sections — as achievement evidence. Those are read at most as a fork-check
> (§Fork Detection). The gate verifies claims; it does not repeat them.
> Design provenance: `2026-06-24-fable-challenge-goal-truth-amped.md` (L1) + the
> reference oracle (goal-truth/oracle.mjs, 0% FP/FN over the calibration corpus).

## Goal Extraction

Parse goals from PRD's Goals section:

```
# If PRD has goal table with ID column:
| ID | Goal | Measurement | Validation Method |
|----|------|-------------|-------------------|
| G-1 | ... | ... | ... |

# Extract: goal_id, goal_description, measurement, validation_method
```

If PRD uses numbered list format without IDs:
- Auto-assign G-1, G-2, G-3 based on order
- Log: `[INFO] Auto-assigned goal IDs: G-1, G-2, G-3`

## Acceptance-Criterion Re-Derivation

For each goal, find contributing tasks + acceptance criteria from sprint.md Appendix C:

```
| Goal ID | Goal Description | Contributing Tasks | Validation Task |
|---------|------------------|-------------------|-----------------|
| G-1 | ... | Sprint 1: Task 1.1, Task 1.2 | Sprint 3: Task 3.E2E |
```

Then RE-DERIVE each criterion's truth from observable state. Pick the decidable check
that matches the criterion's shape (mirrors the reference oracle's clause kinds):

| Criterion shape | Re-derivation (what YOU run/inspect this invocation) |
|---|---|
| code / endpoint / column / file exists | `git cat-file -p HEAD:<path>` or grep the actual tree — never a task checkmark |
| behavior ("returns 401", "test passes") | run the named test/validator yourself; the EXIT CODE is the evidence |
| artifact published / deployed | read the forge/registry state directly (server-recorded SHA, registry entry) |
| integration ("A feeds B") | trace producer→consumer in the tree (§Integration Gap Detection) — this is PRIMARY evidence, not an elevation-only afterthought |
| non-decidable ("feels right", "is safe") | do NOT rubber-stamp: mark the criterion NON-DECIDABLE and the goal AT_RISK with a note to route it to adversarial review |

Record per criterion: the exact command/object inspected, and what came back. A criterion
with no re-derivable evidence is UNVERIFIED, not achieved.

> **Agent-type note:** this subagent runs as `agent: Explore` (fresh context — no worker
> blind-spot; no Write/Edit tools). Evidence commands (`git cat-file`, test runs) execute
> through its Bash tool. The cache write is OPTIONAL: when the agent cannot write, skip
> caching entirely — never trade soundness for the cache.

## Verdict Determination

| Verdict | Criteria |
|---------|----------|
| **GOAL_ACHIEVED** | EVERY acceptance criterion's re-derived predicate HELD when this validator ran it, this invocation — with recorded evidence per criterion |
| **GOAL_AT_RISK** | Re-derivation uncertain, criterion NON-DECIDABLE, missing E2E validation, or integration gaps detected in the tree |
| **GOAL_BLOCKED** | A re-derived predicate FAILED (code/behavior absent from observable state) OR a blocker independently confirmed in the tree |

### Overall Verdict Logic

```
if any goal is BLOCKED:
    overall = GOAL_BLOCKED
elif any goal is AT_RISK:
    overall = GOAL_AT_RISK
else:
    overall = GOAL_ACHIEVED
```

## Blocking Behavior

Configurable in `.loa.config.yaml`:

```yaml
goal_validation:
  enabled: true              # Master toggle
  block_on_at_risk: false    # Default: warn only
  block_on_blocked: true     # Default: always block
  require_e2e_task: true     # Default: require E2E task in final sprint
```

- `GOAL_BLOCKED`: Always blocks `/review-sprint` approval
- `GOAL_AT_RISK`: Blocks only if `block_on_at_risk: true`
- `GOAL_ACHIEVED`: Proceed without issues

## Integration Gap Detection

Check for producer-consumer patterns:

1. **New Data without Consumer:**
   - Search for new database columns/tables (CREATE TABLE, ALTER TABLE ADD)
   - Search for read operations on that data
   - If no consumers found: flag as integration gap

2. **New API without Caller:**
   - Search for new endpoints (@Get, @Post, router definitions)
   - Search for API calls to those endpoints
   - If no callers found: flag as integration gap

Integration gaps elevate goal status to AT_RISK unless marked intentional.

## Output Format

Write report to `grimoires/loa/a2a/subagent-reports/goal-validation-{date}.md`:

```markdown
## Goal Validation Report

**Date**: {YYYY-MM-DD}
**Sprint**: {sprint-id}
**PRD Reference**: `grimoires/loa/prd.md`
**Verdict**: {GOAL_ACHIEVED | GOAL_AT_RISK | GOAL_BLOCKED}

---

### Goal Status Summary

| Goal ID | Goal | Status | Evidence |
|---------|------|--------|----------|
| G-1 | {description} | ✅ ACHIEVED | Task 1.1, 1.2 complete; E2E validated |
| G-2 | {description} | ⚠️ AT_RISK | Tasks complete; no E2E validation |
| G-3 | {description} | ❌ BLOCKED | Task 2.3 incomplete |

---

### Detailed Findings

#### G-1: {Goal Description}

**Status:** ACHIEVED
**Criteria re-derived (evidence per criterion):**
- crit 1.1 — `git cat-file -p HEAD:src/api/timing.ts` → handler present in tree
- crit 1.2 — `pnpm vitest run tests/timing.spec.ts` → exit 0 (14 passed), run this invocation
- crit 2.1 — producer→consumer traced: timing_columns written by ingestor, read by calculate_score()

**E2E Validation:**
- E2E test re-run by validator → exit 0
- Integration confirmed in the tree: data flows from storage to API

---

#### G-2: {Goal Description}

**Status:** AT_RISK
**Contributing Tasks:**
- [x] Sprint 2 Task 2.3 - Complete

**Concern:**
- No E2E validation task exists
- [RECOMMENDATION] Add validation step to verify API returns expected data

---

### Integration Gap Analysis

| Pattern | Found | Consumer | Status |
|---------|-------|----------|--------|
| timing_columns table | ✅ | calculate_score() | ✅ Connected |
| /api/timing endpoint | ✅ | None found | ⚠️ GAP |

---

### Recommendations

1. {Specific recommendation for addressing AT_RISK goals}
2. {Specific recommendation for integration gaps}

---

*Generated by goal-validator v1.1.0 (re-derivation, not self-report)*
```

## Example Invocations

```bash
# Manual invocation via /validate command
/validate goals

# Automatic invocation during review (final sprint)
# Triggered by reviewing-code skill before approval

# Scoped to specific sprint
/validate goals sprint-3
```

## Integration with Review Workflow

The reviewing-code skill should:

1. Check if this is the final sprint (all sprints complete after this)
2. If final sprint, invoke goal-validator before approval
3. Check verdict:
   - GOAL_BLOCKED: Write feedback requiring goal fixes
   - GOAL_AT_RISK: Warn in feedback (or block if configured)
   - GOAL_ACHIEVED: Proceed with standard review

## Backward Compatibility

- If PRD has no goal IDs: auto-assign and continue
- If sprint has no Appendix C: warn but don't block
- If goal_validation disabled in config: skip entirely

## JIT Retrieval Pattern

Follow the JIT retrieval protocol to avoid eager loading of full files:

### Lightweight Identifiers

Store references, not content:

```
# Instead of loading full files:
| Identifier | Purpose | Last Verified |
|------------|---------|---------------|
| ${PROJECT_ROOT}/grimoires/loa/prd.md:L90-110 | Goal definitions | HH:MM:SSZ |
| ${PROJECT_ROOT}/grimoires/loa/sprint.md:L300-350 | Appendix C | HH:MM:SSZ |
```

### On-Demand Retrieval

Load content only when needed for verification:

```bash
# Use ck for semantic search if available
if command -v ck &>/dev/null; then
  ck --hybrid "G-1 contributing tasks" grimoires/loa/sprint.md --top-k 5
else
  grep -n "G-1" grimoires/loa/sprint.md
fi
```

## Semantic Cache Integration

Cache goal validation results to avoid redundant computation across sessions.

> **v1.1.0 — the cache key MUST be content-addressed, never mtime/path-keyed.** An
> mtime-keyed verifier cache is a soundness + DoS surface (touch a file → bust the cache
> or serve a stale-green verdict). The key binds to WHAT WAS JUDGED: the worktree's tree
> SHA + the goal definitions + this validator's own content. If any input can't be
> content-addressed, SKIP the cache for that run — a fast wrong verdict is worse than a
> slow right one.
>
> **Cacheability rule:** ONLY verdicts whose every criterion was re-derived from the
> git tree itself (tree greps, `git cat-file`) are cacheable. If ANY criterion's
> evidence came from process execution (test runs) or external state (registry /
> deploy / forge reads), set `cache_key=""` — the tree SHA does not witness those
> inputs, so a cached ACHIEVED would survive an external change it never saw.

### Cache Key Generation (content-addressed)

```bash
# Key = tree being judged + goal definitions + the judge itself
tree_sha=$(git rev-parse "HEAD^{tree}")
goals_sha=$(git hash-object grimoires/loa/prd.md grimoires/loa/sprint.md | git hash-object --stdin)
judge_sha=$(git hash-object .claude/subagents/goal-validator.md)
cache_key="goalv-${tree_sha:0:16}-$(printf '%s%s' "$goals_sha" "$judge_sha" | shasum -a 256 | cut -c1-16)"
# Dirty worktree? The tree SHA doesn't cover uncommitted changes — skip the cache:
[[ -n "$(git status --porcelain)" ]] && cache_key=""
```

### Cache Check Before Validation

```bash
if [[ -n "$cache_key" ]] && cached=$(.claude/scripts/cache-manager.sh get --key "$cache_key"); then
  # Content-addressed hit: identical tree + goals + judge ⇒ identical verdict
  echo "Using cached goal validation: $cached"
else
  # Cache miss or uncacheable (dirty tree) - perform full validation
  # ... run validation workflow ...

  # Condense and cache result (only when content-addressable)
  if [[ -n "$cache_key" ]]; then
    condensed=$(.claude/scripts/condense.sh condense \
      --strategy structured_verdict \
      --input <(echo "$validation_result"))

    .claude/scripts/cache-manager.sh set \
      --key "$cache_key" \
      --condensed "$condensed" \
      --sources "grimoires/loa/prd.md,grimoires/loa/sprint.md"
  fi
fi
```

### Condensed Verdict Format

```json
{
  "verdict": "GOAL_AT_RISK",
  "goals": {
    "G-1": "ACHIEVED",
    "G-2": "AT_RISK",
    "G-3": "ACHIEVED"
  },
  "concerns": ["G-2: No E2E validation task"],
  "report_path": "grimoires/loa/a2a/subagent-reports/goal-validation-2026-01-23.md"
}
```

## Beads Workflow (beads_rust)

When beads_rust (`br`) is installed, use it to track goal validation:

### Session Start

```bash
br sync --import-only  # Import latest state from JSONL
```

### Recording Goal Validation Results

```bash
# Create validation finding as issue (if gaps found)
if [[ "$verdict" == "GOAL_AT_RISK" ]] || [[ "$verdict" == "GOAL_BLOCKED" ]]; then
  br create --title "Goal validation: $verdict" \
    --type task \
    --priority 1 \
    --json
fi

# Add goal status labels to sprint epic
br label add <sprint-epic-id> "goal-validation:$verdict"
```

### Using Labels for Goal Status

| Label | Meaning | When to Apply |
|-------|---------|---------------|
| `goal-validation:achieved` | All goals met | After GOAL_ACHIEVED verdict |
| `goal-validation:at-risk` | Needs attention | After GOAL_AT_RISK verdict |
| `goal-validation:blocked` | Sprint blocked | After GOAL_BLOCKED verdict |
| `needs-e2e-validation` | Missing E2E task | When E2E task not found |

### Session End

```bash
br sync --flush-only  # Export SQLite → JSONL before commit
```

**Protocol Reference**: See `.claude/protocols/beads-integration.md`

## Truth Hierarchy Compliance

Goal validation follows the Lossless Ledger truth hierarchy:

```
1. CODE (src/)           ← Check actual implementation exists
2. BEADS (.beads/)       ← Track validation state across sessions
3. NOTES.md              ← Log decisions, update Goal Status section
4. TRAJECTORY            ← Record validation reasoning
5. PRD/SDD               ← Source of goal definitions
```

### Fork Detection

The ONLY sanctioned read of worker-authored status (sprint checkmarks, review reports,
NOTES status sections) is here, and its semantics are fixed:

1. **Compare, never adopt** — set each worker claim beside the re-derived state.
   Agreement contributes NOTHING to the verdict (the verdict was already settled by
   re-derivation); divergence is reported as a finding.
2. **Validation wins** — fresh re-derivation is authoritative in every fork
3. **Flag the fork** — log the discrepancy to trajectory (a worker claiming more than
   the tree shows is itself a signal worth surfacing)
4. **Update NOTES.md** — resync the status section to the re-derived truth
