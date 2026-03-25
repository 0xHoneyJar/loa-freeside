# Permissions Reference — Multi-Model Capability Taxonomy

**Version**: 1.0 (cycle-050)
**Schema Version**: 1

## Capability Taxonomy

Model-agnostic intermediate representation of skill tool permissions. Lives in SKILL.md frontmatter as `capabilities:` field.

### Categories

| Capability | Description | Claude Code Tools | Default |
|-----------|-------------|-------------------|---------|
| `read_files` | Read file contents | `Read` | `false` |
| `search_code` | Search files by name or content | `Grep`, `Glob` | `false` |
| `write_files` | Create or modify files | `Write`, `Edit` | `false` |
| `execute_commands` | Run shell commands | `Bash(...)` | `false` |
| `web_access` | Fetch URLs, search web | `WebFetch`, `WebSearch` | `false` |
| `user_interaction` | Ask user questions | `AskUserQuestion` | `false` |
| `agent_spawn` | Launch subagents | `Agent` | `false` |
| `task_management` | Create/update tasks | `TaskCreate`, `TaskUpdate` | `false` |

**Default**: All capabilities default to `false` (deny-all). Unannotated skills get zero capabilities.

### Schema

```yaml
capabilities:
  schema_version: 1        # Required — reject unknown versions
  read_files: true
  search_code: true
  write_files: false
  execute_commands: false   # or structured object (see below)
  web_access: false
  user_interaction: false
  agent_spawn: false
  task_management: false
```

### Strict `execute_commands` Grammar

Commands are tokenized — NOT raw shell strings.

```yaml
execute_commands:
  allowed:
    - command: "git"
      args: ["diff", "*"]
    - command: "git"
      args: ["log", "*"]
    - command: "bats"
      args: ["tests/*"]
  deny_raw_shell: true
```

**Rules**:
- `command`: executable name only (no paths, no shell builtins)
- `args`: array of string arguments
- Glob `*` only in the final argument position
- **Prohibited**: shell operators (`|`, `&&`, `;`, `` ` ``), subshells, variable expansion
- `deny_raw_shell: true` is mandatory — adapters MUST NOT evaluate raw shell strings
- `execute_commands: true` (boolean) = all commands allowed (unrestricted skills only)
- `execute_commands: false` (boolean) = no commands allowed

### Prohibited: `capabilities: all`

The `capabilities: all` sentinel is **prohibited** (Flatline SKP-003). Unrestricted skills must use an explicit expanded map:

```yaml
capabilities:
  schema_version: 1
  read_files: true
  search_code: true
  write_files: true
  execute_commands: true
  web_access: true
  user_interaction: true
  agent_spawn: true
  task_management: true
```

### Schema Versioning

| Version | Changes | Migration |
|---------|---------|-----------|
| 1 | Initial schema (cycle-050) | N/A |

**Rules**: Adapters MUST check `schema_version` and reject unknown versions. Adding new capability categories is a minor version bump (backward-compatible). Changing capability semantics is a major version bump (breaking).

## Cost Profiles

Budget differentiation per skill invocation. Lives in SKILL.md as `cost-profile:` field.

### Tiers

| Profile | Description | Typical Capabilities | Example Skills |
|---------|-------------|---------------------|----------------|
| `lightweight` | Read-only analysis, minimal tokens | `read_files`, `search_code` | `/enhance`, `/flatline-knowledge` |
| `moderate` | Read + limited write, medium tokens | Above + scoped `write_files`, `execute_commands` | `/review-sprint`, `/translate` |
| `heavy` | Full tool access, high token usage | Most capabilities | `/implement`, `/ride`, `/audit` |
| `unbounded` | Autonomous multi-skill orchestration | All capabilities | `/run-bridge`, `/autonomous` |

**Default**: Missing `cost-profile` = validation failure (fail-closed).

### Correlation Rules

| Cost Profile | Allowed | Disallowed (warning if present) |
|-------------|---------|--------------------------------|
| `lightweight` | `read_files`, `search_code`, `user_interaction` | `write_files`, unrestricted `execute_commands`, `agent_spawn` |
| `moderate` | All lightweight + scoped `write_files`, scoped `execute_commands` | Unrestricted `agent_spawn`, `execute_commands: true` |
| `heavy` | Most capabilities | None explicit |
| `unbounded` | All | None |

Correlation violations are **warnings** (promoted to errors in `--strict` mode).

## Validation

### validate-skill-capabilities.sh

```bash
# All skills
.claude/scripts/validate-skill-capabilities.sh

# Single skill
.claude/scripts/validate-skill-capabilities.sh --skill enhancing-prompts

# CI mode (strict + JSON)
.claude/scripts/validate-skill-capabilities.sh --strict --json
```

### Security Invariants

| Condition | Severity | Description |
|-----------|----------|-------------|
| `capabilities.X: false` + tool in `allowed-tools` | **ERROR** | Security violation — capability denies what tool allows |
| `capabilities.X: true` + tool NOT in `allowed-tools` | WARNING | Benign overestimate (ERROR in `--strict`) |
| `capabilities: all` detected | **ERROR** | Must use explicit expanded map |
| Raw shell pattern in `execute_commands` | **ERROR** | Must use tokenized grammar |
| Missing `capabilities` | **ERROR** | Deny-all default |
| Missing `cost-profile` | **ERROR** | Fail-closed |

## Cross-Repo Integration

### For Hounfour Adapters

Read `capabilities:` from SKILL.md to enforce sandboxing on non-Claude backends:

1. Parse `capabilities.schema_version` — reject if unknown
2. For each capability, map to backend-specific tool access
3. Respect `execute_commands.deny_raw_shell` — never pass raw shell to backends
4. If `execute_commands.allowed` is present, only permit listed command+args patterns
5. Reference: [loa-hounfour #49](https://github.com/0xHoneyJar/loa-hounfour/issues/49)

### For Freeside Conservation Guard

Read `cost-profile:` to set per-invocation budget limits:

1. Map tier to budget: `lightweight` < `moderate` < `heavy` < `unbounded`
2. Missing `cost-profile` = validation error (deny)
3. Reference: [loa-freeside #138](https://github.com/0xHoneyJar/loa-freeside/issues/138)

### For Dixie Constitutional Governance

Rule files use lifecycle metadata matching `ConstraintOrigin`:

1. `origin: genesis | enacted | migrated`
2. `version: N` (monotonically increasing integer)
3. `enacted_by: cycle-NNN`
4. Reference: [loa-dixie #80](https://github.com/0xHoneyJar/loa-dixie/issues/80)

## Cross-Repo Permission Propagation (Mount Merge Semantics)

When Loa mounts onto a project via `/mount`, the project may already have `.claude/rules/` files. This section defines how conflicts are detected and resolved.

### Precedence Model (CSS Specificity)

1. **Project-specific rules** (highest priority) — the project's own governance
2. **Loa framework rules** — Loa's zone enforcement
3. **Claude Code defaults** (lowest) — platform behavior without rules

Project rules always win. This mirrors CSS specificity: more specific selectors override less specific ones.

### Conflict Detection

Run `mount-conflict-detect.sh` to analyze overlaps:

```bash
.claude/scripts/mount-conflict-detect.sh \
  --loa-rules .claude/rules \
  --project-rules /target/project/.claude/rules

# JSON output for automation
.claude/scripts/mount-conflict-detect.sh \
  --loa-rules .claude/rules \
  --project-rules /target/project/.claude/rules \
  --json
```

### Conflict Classification

| Type | Condition | Action |
|------|-----------|--------|
| `NO_CONFLICT` | Path patterns don't overlap | Both rule sets apply independently |
| `CONFLICT` | Same path pattern in both | Project rule wins; Loa rule superseded |
| `MULTI_FILE_OVERLAP` | 3+ files claim same path | Hard-fail; require manual resolution |

### Tie-Breaking Rules

| Scenario | Resolution |
|----------|------------|
| Same path, different directives | Project rule wins |
| Same path, same directive | Keep project version, log Loa version as superseded |
| Multi-file overlap (3+ files) | Hard-fail — require explicit manual resolution |
| Transitive mount (project already has Loa rules from older version) | Version check; warn on downgrades |

### Merge Behavior

- **Non-conflicting rules**: Merged automatically with provenance comment
- **Conflicting rules**: Reported with dry-run output; require explicit user confirmation
- **Hard failures**: Block merge entirely; list all conflicting files

### Dry-Run Output

The conflict detector always shows what would happen before making changes:

```
Rule Conflict Detection
========================

  OVERLAP: grimoires/**
    Loa rule:     zone-state.md
    Project rule:  custom-state.md
    Resolution:    Project wins

  NO CONFLICT: .claude/**
    Loa only:     zone-system.md

  NO CONFLICT: data/**
    Project only:  data-rules.md

Merge safe: YES (1 conflict, project-wins resolution)
Action: Merge non-conflicting rules? [Y/n]
```

### Examples

**Clean mount** (no existing project rules):
```
No existing .claude/rules/ in target project.
All Loa rules will be installed.
```

**Non-overlapping rules**:
```
Loa rules: zone-system.md (.claude/**), zone-state.md (grimoires/**)
Project rules: lint-rules.md (src/**), test-rules.md (tests/**)
Result: All rules merged, no conflicts.
```

**Conflicting rules**:
```
Loa zone-state.md claims: grimoires/**
Project custom.md claims: grimoires/**
Resolution: Project custom.md wins for grimoires/**
Loa zone-state.md retained for non-overlapping paths (.beads/**, .ck/**, .run/**)
```
