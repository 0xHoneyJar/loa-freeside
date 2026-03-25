# Anthropic Updates Analysis

**Date**: 2026-03-17
**Oracle Run**: 2026-03-17T12:03:31Z
**Analyst**: Claude (via Anthropic Oracle)
**Loa Version**: v1.39.0

## Executive Summary

- **Agent Teams maturing fast**: TeammateIdle, TaskCompleted hooks, worktree isolation, memory scoping per agent — Loa's v1.39.0 compatibility layer should be validated against latest upstream behavior
- **Hook system significantly expanded**: 15+ event types now including MCPElicitation, InstructionsLoaded, ConfigChange, WorktreeCreate/Remove, and HTTP/agent hook types — Loa uses only ~7 hook events currently
- **Plugin ecosystem launched**: Full plugin architecture with marketplace, custom agents/skills/hooks/MCP — potential distribution channel for Loa constructs
- **Skills `context: fork` enables subagent isolation**: Skills can now run in isolated subagents with `agent` type selection and `model` override — directly applicable to Loa's `/run` parallelization
- **Memory system unified**: Auto-memory with configurable directory, path-scoped `.claude/rules/`, and cross-worktree sharing — overlaps with Loa's `grimoires/loa/memory/observations.jsonl`

---

## New Features Identified

### Feature 1: Plugin System & Marketplace

**Source**: Claude Code Changelog + Docs
**Relevance to Loa**: High

**Description**:
Full plugin architecture allowing distribution of custom agents, skills, hooks, and MCP servers. Plugins install from git repos or marketplaces, auto-update, and namespace with `plugin-name:skill-name`.

**Potential Integration**:
Loa constructs could be distributed as Claude Code plugins, enabling `claude install` for construct packs instead of the current `/constructs` skill. This would provide versioning, auto-updates, and marketplace discovery.

**Implementation Effort**: High

---

### Feature 2: Skill `context: fork` with Agent Type Selection

**Source**: Skills Documentation
**Relevance to Loa**: High

**Description**:
Skills can declare `context: fork` in frontmatter to run in an isolated subagent. Combined with `agent: Explore/Plan/general-purpose/custom`, this enables parallel skill execution with context isolation and model override per skill.

**Potential Integration**:
Loa's `/run sprint-plan` could fork implementation tasks into isolated subagents, each with appropriate tool restrictions via `allowed-tools`. The bridge review loop could run Bridgebuilder as a forked agent with read-only tools.

**Implementation Effort**: Medium

---

### Feature 3: HTTP Hooks

**Source**: Hooks Documentation
**Relevance to Loa**: Medium

**Description**:
Hooks can now POST JSON to HTTP endpoints instead of running shell scripts. Non-blocking on errors. Enables webhook-style integrations without local scripts.

**Potential Integration**:
Loa's mutation logger and audit trail could forward events to external observability systems (Grafana, Datadog) via HTTP hooks. Run mode state changes could notify external dashboards.

**Implementation Effort**: Low

---

### Feature 4: Agent-Based Hooks (Verification Subagents)

**Source**: Hooks Documentation
**Relevance to Loa**: Medium

**Description**:
Hook type `agent` spawns a verification subagent with Read, Grep, Glob tools to make complex decisions. The subagent analyzes code context and returns allow/block decisions.

**Potential Integration**:
Loa's implementation compliance checks (NEVER rules) could be enforced via agent hooks that verify sprint plan existence, beads health, and review/audit completion before allowing code writes. More sophisticated than regex-based shell hooks.

**Implementation Effort**: Medium

---

### Feature 5: MCPElicitation & MCPElicitationResponse Hooks

**Source**: Hooks Documentation
**Relevance to Loa**: Medium

**Description**:
New hook events fire when MCP servers request structured user input mid-task. Enables programmatic interception and response to MCP server requests.

**Potential Integration**:
If Loa exposes construct capabilities via MCP servers, these hooks enable automated responses during autonomous `/run` mode, preventing MCP elicitations from blocking autonomous workflows.

**Implementation Effort**: Low

---

### Feature 6: Path-Scoped `.claude/rules/` Files

**Source**: Memory Documentation
**Relevance to Loa**: Medium

**Description**:
Rules files in `.claude/rules/` can include `paths:` frontmatter to scope rules to specific file patterns (e.g., `*.tsx`). Rules load on-demand when matching files are edited, reducing baseline context consumption.

**Potential Integration**:
Loa's zone permissions (System/State/App) could be enforced via path-scoped rules instead of relying solely on hooks. Zone-specific coding standards (e.g., shell style for `.claude/scripts/`, TypeScript patterns for `src/`) would load only when relevant.

**Implementation Effort**: Low

---

### Feature 7: InstructionsLoaded Hook Event

**Source**: Hooks Documentation / Changelog
**Relevance to Loa**: Low

**Description**:
Fires when CLAUDE.md or `.claude/rules/*.md` files are loaded. Audit-only (cannot block).

**Potential Integration**:
Loa could log which instructions were loaded per session for debugging and compliance. Useful for verifying that framework instructions (`CLAUDE.loa.md`) are always loaded.

**Implementation Effort**: Low

---

### Feature 8: Worktree Sparse Checkout (`worktree.sparsePaths`)

**Source**: Changelog
**Relevance to Loa**: Low

**Description**:
New `worktree.sparsePaths` setting enables git sparse-checkout in worktrees, significantly reducing disk usage and startup time for large monorepos.

**Potential Integration**:
For large projects using Loa, agent teams running in worktrees could use sparse checkout to only include relevant directories, improving parallel execution performance.

**Implementation Effort**: Low

---

### Feature 9: Scheduled Tasks

**Source**: Docs
**Relevance to Loa**: Medium

**Description**:
Claude Code now supports recurring automation and scheduled tasks natively, enabling time-based execution of commands.

**Potential Integration**:
Loa's oracle checks, BUTTERFREEZONE validation, and GT staleness detection could be scheduled natively instead of relying on GitHub Actions cron. The `/loop` command already exists as a skill — native scheduling would be more robust.

**Implementation Effort**: Low

---

### Feature 10: `attribution` Setting (Replaces `includeCoAuthoredBy`)

**Source**: Changelog
**Relevance to Loa**: Low

**Description**:
New `attribution` setting to customize commit and PR bylines. Deprecates the boolean `includeCoAuthoredBy` flag.

**Potential Integration**:
Loa's post-merge automation could respect this setting for commit attribution consistency.

**Implementation Effort**: Low

---

## API Changes

| Change | Type | Impact on Loa | Action Required |
|--------|------|---------------|-----------------|
| Opus 4.6 default 128k output tokens | New | model-adapter.sh token limits | No (informational) |
| `inference_geo` parameter on Messages API | New | Data residency compliance | No |
| Opus 4.0/4.1 removed from first-party API | Deprecated | Backward compat aliases | Yes — verify alias chain |
| `total_cost` renamed to `total_cost_usd` in SDK | Breaking | Any SDK cost tracking | Check if Loa uses SDK cost APIs |
| Legacy SDK entrypoint removed | Breaking | @anthropic-ai/claude-agent-sdk is new path | Check imports |
| Python SDK at v0.85.0, default model `claude-opus-4-6` | New | SDK examples | Informational |

---

## Deprecations & Breaking Changes

### Opus 4.0 / 4.1 Auto-Migration

**Effective Date**: Already active
**Loa Impact**: `model-adapter.sh` backward compat aliases must map `claude-opus-4-0` and `claude-opus-4-1` to `claude-opus-4-6`. PR #207 added aliases for 4.5→4.6 but 4.0/4.1 need verification.
**Migration Path**: Verify all four associative arrays (MODEL_PROVIDERS, MODEL_IDS, COST_INPUT, COST_OUTPUT) have entries for deprecated model IDs.

### `/output-style` Command Deprecated

**Effective Date**: Current
**Loa Impact**: None — Loa doesn't use this command
**Migration Path**: Use `/config` instead

### `includeCoAuthoredBy` Setting Deprecated

**Effective Date**: Current
**Loa Impact**: Low — check if `.loa.config.yaml` or hooks reference this
**Migration Path**: Use `attribution` setting

### Legacy SDK Entrypoint Removed

**Effective Date**: Current
**Loa Impact**: If any Loa scripts import the old SDK package, they need updating
**Migration Path**: Use `@anthropic-ai/claude-agent-sdk`

---

## Best Practices Updates

### Practice 1: Use `allowed-tools` in Skill Frontmatter for Safety

**Previous Approach**: Loa relies on hooks (team-role-guard-write.sh, team-skill-guard.sh) to restrict tool access
**New Recommendation**: Skills can declaratively restrict tools via `allowed-tools` frontmatter. This is cheaper than hooks (no subprocess overhead) and more explicit.
**Loa Files Affected**: `.claude/skills/**/*.md` — review-only skills should declare `allowed-tools: "Read, Grep, Glob, WebFetch"`

### Practice 2: Use `context: fork` for Expensive Skills

**Previous Approach**: Skills run in main conversation context, consuming tokens from the shared budget
**New Recommendation**: Skills that produce large outputs (e.g., `/ride`, `/audit`) should use `context: fork` to run in isolated subagents, preventing context bloat
**Loa Files Affected**: `.claude/skills/*/SKILL.md` for skills producing >10k tokens of output

### Practice 3: Scope Rules via `.claude/rules/` Path Matching

**Previous Approach**: All instructions loaded at session start via CLAUDE.md imports
**New Recommendation**: Move file-type-specific rules (shell scripting conventions, test patterns) to `.claude/rules/` with `paths:` frontmatter for on-demand loading
**Loa Files Affected**: `.claude/loa/CLAUDE.loa.md` (reduce size), new `.claude/rules/*.md` files

### Practice 4: Skills Without Side Effects Don't Need Permission Prompts

**Previous Approach**: All skill invocations may prompt the user
**New Recommendation**: Skills without `hooks` or additional `permissions` in frontmatter are now auto-allowed without approval. Loa's read-only skills can leverage this.
**Loa Files Affected**: Skills that are informational (e.g., `/loa`, `/run-status`, `/ledger`)

---

## Gaps Analysis

| Loa Feature | Anthropic Capability | Gap | Priority |
|-------------|---------------------|-----|----------|
| Safety hooks (shell scripts) | Agent-based hooks (subagent verification) | Loa hooks are shell-only; agent hooks enable code-aware decisions | P2 |
| Constructs via `/constructs` skill | Plugin marketplace with `claude install` | No native distribution/versioning for Loa constructs | P3 |
| Sequential skill execution | `context: fork` + agent type selection | Loa skills run serially in main context; forking enables parallelism | P2 |
| `grimoires/loa/memory/observations.jsonl` | Auto-memory with `MEMORY.md` index | Dual memory systems that may diverge | P2 |
| Hook events: ~7 used | 15+ hook events available | MCPElicitation, InstructionsLoaded, ConfigChange, WorktreeCreate unused | P3 |
| CLAUDE.loa.md (monolithic) | Path-scoped `.claude/rules/` | All rules loaded at startup regardless of relevance | P2 |
| model-adapter.sh (shell) | `modelOverrides` setting (native) | Shell-based model routing vs. native config | P3 |
| `/run` sequential implementation | Worktree + sparse checkout parallelism | Agent teams + worktrees could parallelize sprint tasks | P1 |
| Flatline (Opus + GPT review) | Plugin-based multi-model review | Flatline is custom; plugins could standardize the pattern | P3 |
| HTTP hooks: none | Native HTTP hook support | Loa could forward audit events to external systems | P3 |
| Scheduled tasks via cron/GHA | Native Claude Code scheduled tasks | Could replace external scheduling for oracle/validation | P3 |

---

## Recommended Actions

### Priority 1 (Immediate)

1. **Validate Agent Teams hook compatibility**: Loa v1.39.0 added Agent Teams support. Verify that `TeammateIdle` and `TaskCompleted` hooks are correctly handled by Loa's safety hooks (block-destructive-bash.sh, team-role-guard.sh). Test with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
   - Effort: Low
   - Files: `.claude/hooks/`, `.claude/loa/reference/agent-teams-reference.md`

2. **Verify Opus 4.0/4.1 backward compat aliases**: Anthropic removed Opus 4.0/4.1 from first-party API with auto-migration to 4.6. Ensure `model-adapter.sh` handles these gracefully.
   - Effort: Low
   - Files: `.claude/scripts/model-adapter.sh`

3. **Add `allowed-tools` to read-only skills**: Skills like `/loa`, `/run-status`, `/ledger`, `/reality` should declare `allowed-tools` in frontmatter to prevent accidental writes and skip permission prompts.
   - Effort: Low
   - Files: `.claude/skills/*/SKILL.md` (read-only skills)

### Priority 2 (Next Release)

1. **Adopt `context: fork` for heavy skills**: Skills producing large outputs (`/ride`, `/audit`, `/bridgebuilder-review`) should fork into subagents to preserve main context budget.
   - Effort: Medium
   - Files: `.claude/skills/*/SKILL.md`

2. **Extract path-scoped rules from CLAUDE.loa.md**: Move file-type-specific instructions (shell conventions, test patterns, security checks) to `.claude/rules/` with path scoping. Reduces baseline token load.
   - Effort: Medium
   - Files: `.claude/loa/CLAUDE.loa.md` → `.claude/rules/*.md`

3. **Reconcile dual memory systems**: Loa has `grimoires/loa/memory/observations.jsonl` (persistent memory) AND Claude Code auto-memory (`~/.claude/projects/.../memory/`). Define clear ownership: auto-memory for user preferences, observations.jsonl for framework learnings.
   - Effort: Low
   - Files: `.claude/loa/reference/memory-reference.md`, documentation

4. **Explore agent-based hooks for compliance**: Replace shell-based NEVER rule enforcement with agent hooks that can read code context and make nuanced decisions (e.g., "is this code being written inside an /implement skill invocation?").
   - Effort: High
   - Files: `.claude/hooks/`

### Priority 3 (Future)

1. **Evaluate plugin distribution for constructs**: Investigate packaging Loa construct packs as Claude Code plugins for marketplace distribution with versioning and auto-updates.
   - Effort: High
   - Files: Architecture decision

2. **Add HTTP hooks for audit trail**: Forward `.run/audit.jsonl` events to external observability systems via HTTP hooks for real-time monitoring of autonomous runs.
   - Effort: Medium
   - Files: `.claude/hooks/settings.json`

3. **Leverage native scheduled tasks**: Replace GitHub Actions cron for oracle checks and BUTTERFREEZONE validation with Claude Code native scheduling.
   - Effort: Low
   - Files: `.github/workflows/oracle.yml`

4. **Investigate `modelOverrides` as model-adapter replacement**: The native `modelOverrides` setting may simplify Loa's shell-based model routing, eliminating associative array fragility.
   - Effort: Medium
   - Files: `.claude/scripts/model-adapter.sh`

---

## Sources Analyzed

| Source | File | Size | Status |
|--------|------|------|--------|
| Claude Code Changelog | `~/.loa/cache/oracle/changelog.html` | 2.0 MB | Analyzed |
| Claude Code Docs | `~/.loa/cache/oracle/docs.html` | 764 KB | Analyzed |
| Anthropic Blog | `~/.loa/cache/oracle/blog.html` | 351 KB | Analyzed |
| API Reference | `~/.loa/cache/oracle/api_reference.html` | 478 KB | Analyzed |
| Hooks Documentation | `~/.loa/cache/oracle/hooks.html` | 2.9 MB | Analyzed |
| Memory Documentation | `~/.loa/cache/oracle/memory.html` | 862 KB | Analyzed |
| Skills Documentation | `~/.loa/cache/oracle/skills.html` | 1.4 MB | Analyzed |
| GitHub Claude Code | `~/.loa/cache/oracle/github_claude_code.html` | 303 KB | Analyzed |
| GitHub SDK | `~/.loa/cache/oracle/github_sdk.html` | 327 KB | Analyzed |

---

## Next Oracle Run

Recommended: 2026-03-24 or when Anthropic announces major updates.
