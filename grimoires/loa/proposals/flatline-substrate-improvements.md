# Flatline Substrate Improvements — Distilled from Cycle 2026-05-25 PM

**Status**: Proposed (cluster-meta proposal; targets Loa upstream + cluster doctrine)
**Date**: 2026-05-25 PM
**Author**: ai-derived (operator-directed; mad-latitude)
**Triggered by**: flatline-batch 2026-05-25 PM (`loa-freeside/grimoires/freeside-network/flatline-batch-2026-05-25/findings.md`)
**Composes with**: [coord-flow-enhancement.md](coord-flow-enhancement.md) (validated thesis: bootstrap-with-flatline catches real blockers)

> Three substrate-level improvements distilled from running flatline-orchestrator on real doctrine (ADR-009 + W2 PRD + W3 PRD) with all-headless adapters at $0 cost. Each lesson has a symptom, root cause, fix proposal, and verification plan. Together they harden the Flatline Protocol for the /coord-with-flatline flow proposed in coord-flow-enhancement.md.

## Lesson 1 — flatline-readiness has an alias-awareness bug

### Symptom

```bash
$ .claude/scripts/flatline-readiness.sh --json
{
  "status": "DEGRADED",
  "exit_code": 3,
  "providers": {
    "anthropic": { "configured": true, "available": false, "env_var": "ANTHROPIC_API_KEY" },
    "openai":    { "configured": false, "available": false, "env_var": "" },
    "google":    { "configured": true, "available": true, "env_var": "GOOGLE_API_KEY" }
  },
  "models": { "primary": "claude-headless", "secondary": "codex-headless", "tertiary": "gemini-headless" },
  "recommendations": [ "Set ANTHROPIC_API_KEY for anthropic provider" ]
}
```

Reported `DEGRADED` when `ANTHROPIC_API_KEY` is unset. But the configured primary is `claude-headless` — which **does NOT need** `ANTHROPIC_API_KEY` (it invokes the Claude CLI using the operator's session credentials).

Empirical disproof: I ran `flatline-orchestrator.sh --doc <doc> --phase spec --autonomous --json` with this exact "DEGRADED" state. **It succeeded with full 3-model rigor at $0 cost.** The script lied about readiness.

### Root cause

In `.claude/scripts/flatline-readiness.sh` lines 81-95:

```bash
map_model_to_provider() {
    local model="$1"
    case "$model" in
        opus|claude-*|anthropic-*)
            echo "anthropic:ANTHROPIC_API_KEY" ;;
        gpt-*|openai-*)
            echo "openai:OPENAI_API_KEY" ;;
        gemini-*|google-*)
            echo "google:GOOGLE_API_KEY:GEMINI_API_KEY" ;;
        *)
            echo "unknown:" ;;
    esac
}
```

The `claude-*` glob matches `claude-headless` and routes to `anthropic:ANTHROPIC_API_KEY` — but `claude-headless` doesn't need any env var. Same bug class for `codex-headless` (matches nothing → unknown) and `gemini-headless` (matches `gemini-*` → routes to `google:GOOGLE_API_KEY`, accidentally correct because `GOOGLE_API_KEY` happens to be set, but for the wrong reason).

### Fix

Add `*-headless` pattern matching BEFORE the existing patterns, routing to a synthetic `cli:NONE` indicator that the env-var check treats as "always available":

```bash
map_model_to_provider() {
    local model="$1"
    case "$model" in
        # *-headless aliases use CLI session credentials, not API keys.
        # Match these BEFORE the general patterns so claude-headless doesn't
        # fall through to claude-* → ANTHROPIC_API_KEY check.
        claude-headless)
            echo "anthropic-cli:CLI_SESSION" ;;
        codex-headless|gpt-headless)
            echo "openai-cli:CLI_SESSION" ;;
        gemini-headless)
            echo "google-cli:CLI_SESSION" ;;
        # API-key-based aliases (original behavior)
        opus|claude-*|anthropic-*)
            echo "anthropic:ANTHROPIC_API_KEY" ;;
        gpt-*|openai-*)
            echo "openai:OPENAI_API_KEY" ;;
        gemini-*|google-*)
            echo "google:GOOGLE_API_KEY:GEMINI_API_KEY" ;;
        *)
            echo "unknown:" ;;
    esac
}
```

Then the downstream env-var check (somewhere later in the script) needs to know that `CLI_SESSION` is not an env var to check — instead, it should verify the corresponding CLI tool exists in PATH:

```bash
# Pseudocode for the downstream check
case "$env_var" in
    CLI_SESSION)
        # Check CLI tool availability instead of env var
        case "$provider_kind" in
            anthropic-cli) command -v claude >/dev/null 2>&1 && available=true ;;
            openai-cli)    command -v codex  >/dev/null 2>&1 && available=true ;;
            google-cli)    command -v gemini >/dev/null 2>&1 && available=true ;;
        esac
        ;;
    *)
        # Original env-var check
        if [ -n "${!env_var:-}" ]; then available=true; fi
        ;;
esac
```

### Verification plan

1. Apply patch to `.claude/scripts/flatline-readiness.sh` (System Zone — requires explicit cycle-level approval per `.claude/rules/zone-system.md`)
2. Re-run readiness with all-headless config:
   ```bash
   .claude/scripts/flatline-readiness.sh --json
   ```
3. Expected: `status: READY`, `available: true` for all 3 providers, `recommendations: []`
4. Re-run with API-key config (e.g., primary: opus):
   ```bash
   # Should still flag if ANTHROPIC_API_KEY missing
   .claude/scripts/flatline-readiness.sh --json
   ```
5. Add `bats` test at `.claude/tests/integration/flatline-readiness-headless.bats` covering both transport modes.

### Scope note

This patch lives in System Zone (`.claude/scripts/`). Per `.claude/rules/zone-system.md`, "Authorized System Zone writes require explicit cycle-level approval in the PRD." This proposal IS the PRD; operator ratification + a small cycle to land the patch closes the loop.

---

## Lesson 2 — flatline-knowledge-retrieval misses live `.claude/` tree

### Symptom

The flatline-batch 2026-05-25 PM caught a finding "**SKP-002 HIGH 730 — /update-loa doesn't exist at ratification**" against ADR-009. The reviewers concluded `/update-loa` does not exist based on ADR-009's prose ("a small follow-up cycle").

**But `/update-loa` absolutely exists** comprehensively:
- `.claude/scripts/update-loa.sh` (unified update; auto-detects mode; pre-flight; supply-chain checks)
- `.claude/scripts/update-loa-bump-version.sh` (Phase 5.6 version-marker refresh)
- `.claude/scripts/mount-loa.sh` (initial mount)
- `.claude/commands/update-loa.md` (slash command at v1.3.0)

The reviewers MANUFACTURED a blocker finding because doctrine prose understated existing tooling.

### Root cause

Flatline-orchestrator's knowledge retrieval phase reads:
- The document under review
- Some configurable domain knowledge (via `--domain` flag or auto-extracted)

It does NOT read:
- The actual `.claude/scripts/` directory contents
- The actual `.claude/commands/` directory contents
- Anything else in the project's filesystem

So if doctrine says "we'll need /update-loa as a small follow-up cycle" instead of "see `.claude/scripts/update-loa.sh` (v1.3.0)", reviewers conclude the tool doesn't exist.

### Fix proposal

Add a new optional phase to `flatline-orchestrator.sh`: **TOOLING PROBE**. Runs between INIT and KNOWLEDGE phases. Behavior:

```bash
# .claude/scripts/flatline-orchestrator.sh — new flag
#   --probe-tooling          Scan .claude/scripts/ + .claude/commands/ for references mentioned in the doc
#   --tooling-allowlist FILE One file per line of additional paths to check (defaults: .claude/scripts/, .claude/commands/, .claude/skills/)
```

The TOOLING PROBE phase:
1. Extracts tooling-reference candidates from the document (regex match for `/word-with-dashes`, `\.sh` filenames, `command.md` references)
2. For each candidate, checks whether it exists in the allowlist directories
3. If found, adds to the knowledge-retrieval context as `[VERIFIED-TOOLING] <path>: <first 20 lines of content>`
4. Both reviewers see the verified tooling in their context window; they no longer manufacture "doesn't exist" findings

### Verification plan

1. Apply patch to `flatline-orchestrator.sh`
2. Re-run on ADR-009 v0.2 (which now cites `/update-loa` correctly):
   - With `--probe-tooling`: should NOT surface the "/update-loa doesn't exist" class of finding
   - Without `--probe-tooling`: should still surface it (regression test for the bug class)
3. Re-run on a synthetic test doc that mentions a tool that doesn't exist (e.g., `/never-existed`):
   - With `--probe-tooling`: should correctly flag it (still useful)
   - Verifies the probe doesn't falsely-verify nonexistent tooling

### Cost trade-off

The probe phase costs ~$0 in API spend (filesystem scan + regex). Adds ~5-10 seconds wall-clock per flatline. Reduces false-positive blocker findings dramatically. Net win.

### Scope note

Also System Zone; same operator-cycle-approval pattern as Lesson 1.

---

## Lesson 3 — Doctrine prose discipline (the rule that closes the loop)

### Symptom

Independent of the script bugs above, the proximate cause of the bad finding was ADR-009's prose: *"A dedicated Loa skill encoding this recipe is a small follow-up cycle."*

This prose:
- Does NOT cite the existing `/update-loa` skill
- Implies (without explicitly saying) the skill doesn't exist
- Made the flatline reviewers manufacture a blocker

The script fixes (Lesson 1 + Lesson 2) make doctrine writers' jobs easier, but they don't eliminate the human-in-the-loop responsibility. **Doctrine prose must cite tooling verbatim.**

### Convention proposal

Add to the PRD template at `.claude/skills/discovering-requirements/resources/templates/prd-template.md` (verified path 2026-05-25 PM — the `/plan-and-analyze` slash command routes to this skill; ground-check caught my initial wrong-path citation):

> **Tooling Citation Rule** (added 2026-05-25 PM, distilled from flatline-substrate-improvements proposal): when a doctrine document mentions a Loa-native skill, script, or slash-command, it MUST cite the canonical path verbatim. Do not use "or equivalent", "small follow-up cycle", or other prose that obscures whether the tooling exists. Examples:
>
> ❌ DON'T: "A dedicated /update-loa skill is a small follow-up cycle."
>
> ✅ DO: "Framework updates flow through `.claude/scripts/update-loa.sh` (slash command at `.claude/commands/update-loa.md` v1.3.0); auto-detects submodule vs vendored mode."
>
> If the tooling does NOT exist and the doctrine references it as future work, the prose MUST be explicit about that AND include an owner + trigger + acceptance criteria (per ADR-009 D-13 / flatline pattern "Future-work-as-current-mitigation").

### Verification plan

1. Add the rule to the PRD/ADR template
2. Add a check to the existing review/audit skills (e.g., `review-sprint`, `audit-sprint`): scan the doc for prose-pattern matches like "small follow-up cycle", "or equivalent", "future work" and flag them for explicit tooling citation
3. Operator can choose: hard-fail or warn-only

### Composition with Lessons 1 + 2

Lesson 3 is the operator-side discipline; Lessons 1 + 2 are the script-side defenses. Together they form a 3-layer safety net:

```
Layer 1 (operator)  : Cite tooling verbatim (Lesson 3 convention)
Layer 2 (script)    : Probe .claude/ for tooling references at flatline-time (Lesson 2 --probe-tooling)
Layer 3 (script)    : Recognize *-headless aliases as CLI-transport (Lesson 1 alias-awareness)
```

Layer 1 alone is sufficient if perfectly applied; Layers 2 + 3 are the defense-in-depth.

---

## Composition with /coord-flow-enhancement.md

The /coord-flow-enhancement proposal argues bootstrap should compose /simstim (which composes flatline at gates 2/4/6) for cluster-wide doctrine + per-cell PRD/SDD/Sprint rigor. **The flatline-batch 2026-05-25 PM empirically validated the thesis** — 23 blockers caught that would have shipped without the gate. These Lessons make that composition MORE reliable:

- Lesson 1: enables /coord bootstrap to confidently fire flatline with all-headless config (no false-DEGRADED blocking)
- Lesson 2: reduces false-positive findings (which would otherwise waste operator triage time)
- Lesson 3: improves the doctrine that flatline reviews (closes the loop at the authoring layer)

When all 3 land, /coord-with-flatline becomes the canonical cluster-doctrine flow:

```
/coord bootstrap
  → /simstim (PRD/SDD/Sprint with flatline at gates 2/4/6)
    → flatline-readiness (Lesson 1: alias-aware; no false DEGRADED)
      → flatline-orchestrator (Lesson 2: --probe-tooling; no false "tool doesn't exist" blockers)
        → reviewers see verified tooling + accurate prose (Lesson 3 discipline)
          → high-consensus auto-integrate; disputed/blockers surface for operator decide
            → /run-bridge per cell sprint
              → kaironic flatline termination → cycle close → distill
```

## Sequencing + ownership

| Lesson | Scope | Owner | Effort | Priority |
|--------|-------|-------|--------|----------|
| 1: alias-aware flatline-readiness | System Zone patch | Loa maintainer | ~1 hour (patch + bats test) | HIGH (blocks confident /coord-with-flatline) |
| 2: --probe-tooling flatline-orchestrator | System Zone patch | Loa maintainer | ~half-day (patch + regression test + doc) | MEDIUM (reduces false-positive overhead but doesn't block) |
| 3: doctrine prose convention | Template + review-skill update | Loa maintainer | ~30 min (template addition + scan logic) | LOW (improvement; ops without it are imperfect-but-functional) |

Recommended sequence: Lesson 1 first (smallest, highest leverage); Lesson 2 second (test on a few flatlines to verify reduced false-positives); Lesson 3 third (after the script-side defenses prove out, the convention reinforces them).

## Status

Proposed. Awaiting operator decision on:
1. Open issues upstream in `0xHoneyJar/loa` for Lessons 1 + 2 (System Zone patches)
2. Open PR against loa-freeside `.claude/skills/discovering-requirements/resources/templates/` for Lesson 3 (template addition)
3. Or: bundle all three into a single cycle-meta cycle ("flatline-substrate-hardening")

## References

- Source flatline-batch: `loa-freeside/grimoires/freeside-network/flatline-batch-2026-05-25/findings.md`
- Coord flow enhancement proposal: `loa-freeside/grimoires/loa/proposals/coord-flow-enhancement.md`
- Bug location: `loa-freeside/.claude/scripts/flatline-readiness.sh` lines 81-95
- /update-loa tooling that flatline didn't see: `.claude/scripts/update-loa.sh` + `.claude/commands/update-loa.md` + `.claude/scripts/update-loa-bump-version.sh`
- ADR-009 v0.2 (which now cites /update-loa correctly): `loa-freeside/decisions/009-freeside-hexagonal-federation.md`
- Zone-system rules (System Zone authorization): `loa-freeside/.claude/rules/zone-system.md`
