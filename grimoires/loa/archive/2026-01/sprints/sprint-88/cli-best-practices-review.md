# CLI Best Practices Review: Discord Server Sandboxes

**Document Type**: Architecture Review
**Date**: 2026-01-17
**Reviewer**: Software Architect
**Reference**: https://clig.dev/

---

## Executive Summary

Reviewed the Discord Server Sandboxes CLI implementation (`packages/cli/src/commands/sandbox/`) against clig.dev best practices. The implementation is well-designed with **85/100 compliance score**. Six issues identified requiring remediation to achieve full compliance.

---

## Scope

### Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `index.ts` | 174 | Command group registration |
| `create.ts` | 120 | Sandbox creation |
| `list.ts` | 154 | List sandboxes |
| `destroy.ts` | 167 | Destroy sandbox |
| `connect.ts` | 135 | Get connection env vars |
| `status.ts` | 237 | Health status display |
| `register.ts` | 170 | Register guild |
| `unregister.ts` | 145 | Unregister guild |
| `utils.ts` | 301 | Shared utilities |

**Total**: ~1,600 lines across 9 files

---

## Compliance Summary

### What's Working Well

| Area | Score | Notes |
|------|-------|-------|
| Philosophy | 10/10 | Human-first, composable, consistent |
| Help Text | 10/10 | Examples on all commands, suggestions |
| JSON Output | 10/10 | `--json` on all 8 commands |
| Error Handling | 9/10 | Structured errors with codes |
| Arguments & Flags | 9/10 | Standard names, sensible defaults |
| Subcommands | 10/10 | Consistent naming, clear aliases |
| Configuration | 8/10 | Env vars, flag precedence |
| Robustness | 8/10 | Early validation, graceful shutdown |

### Issues Requiring Fixes

| Issue | Severity | clig.dev Principle |
|-------|----------|-------------------|
| No TTY detection for spinners | Medium | "Disable animations for non-TTY" |
| No TTY check before prompting | High | "Check for TTY before prompting" |
| No `--no-color` flag | Medium | Standard flag support |
| No `NO_COLOR` env var check | Low | Environment variable standards |
| No `--quiet` flag | Low | Standard flag support |
| No `--dry-run` flag | Low | Standard flag support |

---

## Issue Details

### Issue 1: No TTY Detection for Spinners

**Severity**: Medium
**clig.dev Quote**: "Disable animations for non-TTY: Prevents progress bars from corrupting CI logs"

**Current Behavior**:
```typescript
// create.ts:51-53
if (!options.json) {
  spinner.start('Creating sandbox...');
}
```

Spinners run regardless of whether stdout is a TTY, causing corrupted output in CI/CD pipelines and when piped.

**Required Change**:
```typescript
const spinner = process.stdout.isTTY && !options.json
  ? ora('Creating sandbox...').start()
  : null;
```

**Affected Files**:
- `create.ts` (line 51)
- `destroy.ts` (line 134)
- `status.ts` (line 152)
- `register.ts` (line 35)
- `unregister.ts` (line 35)

---

### Issue 2: No TTY Check Before Prompting

**Severity**: High
**clig.dev Quote**: "Check for TTY before prompting... scripts should use flags"

**Current Behavior**:
```typescript
// destroy.ts:114
if (!options.yes && !options.json) {
  const confirmed = await confirm(...);
}
```

If stdin is not a TTY (e.g., piped input, CI), the command hangs waiting for input that will never come.

**Required Change**:
```typescript
// Skip prompt if not interactive
if (!options.yes && !options.json) {
  if (!process.stdin.isTTY) {
    console.error(chalk.red('Error: Cannot prompt for confirmation in non-interactive mode.'));
    console.error(chalk.yellow('Use --yes to skip confirmation.'));
    process.exit(1);
  }
  const confirmed = await confirm(...);
}
```

**Affected Files**:
- `destroy.ts` (line 114)

---

### Issue 3: No `--no-color` Flag

**Severity**: Medium
**clig.dev Quote**: "Disable color if... user passes --no-color"

**Current Behavior**: No way to disable colors via flag.

**Required Change**: Add global `--no-color` flag to parent command.

```typescript
// index.ts
export function createSandboxCommand(): Command {
  const sandbox = new Command('sandbox')
    .description('Manage Discord server sandboxes for isolated testing')
    .option('--no-color', 'Disable colored output')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      if (opts.noColor) {
        chalk.level = 0;
      }
    });
  // ...
}
```

**Affected Files**:
- `index.ts` (add option and hook)

---

### Issue 4: No `NO_COLOR` Environment Variable Check

**Severity**: Low
**clig.dev Quote**: "Disable color if NO_COLOR environment variable is set"

**Current Behavior**: `NO_COLOR` env var is ignored.

**Required Change**: Check `NO_COLOR` and `TERM=dumb` at startup.

```typescript
// utils.ts - add new function
export function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

// index.ts - in preAction hook
if (!shouldUseColor() || opts.noColor) {
  chalk.level = 0;
}
```

**Affected Files**:
- `utils.ts` (add helper)
- `index.ts` (use in hook)

---

### Issue 5: No `--quiet` Flag

**Severity**: Low
**clig.dev Quote**: Standard flag `-q, --quiet`

**Current Behavior**: No way to suppress informational output.

**Required Change**: Add `--quiet` flag that suppresses non-essential output (spinners, suggestions, extra formatting).

```typescript
// index.ts
.option('-q, --quiet', 'Suppress non-essential output')

// create.ts - example usage
if (!options.json && !options.quiet) {
  console.log(chalk.dim('To connect workers to this sandbox:'));
  console.log(chalk.dim(`  eval $(bd sandbox connect ${result.sandbox.name})`));
}
```

**Affected Files**:
- `index.ts` (add flag)
- `create.ts` (use flag)
- `destroy.ts` (use flag)
- `status.ts` (use flag)
- `list.ts` (use flag)
- `register.ts` (use flag)
- `unregister.ts` (use flag)

---

### Issue 6: No `--dry-run` Flag

**Severity**: Low
**clig.dev Quote**: Standard flag `-n, --dry-run`

**Current Behavior**: No way to preview destructive actions.

**Required Change**: Add `--dry-run` to `create` and `destroy` commands.

```typescript
// destroy.ts
.option('-n, --dry-run', 'Show what would be destroyed without doing it')

// In action:
if (options.dryRun) {
  console.log(chalk.yellow('DRY RUN - No changes made'));
  console.log(`Would destroy sandbox: ${sandbox.name}`);
  console.log(`  Schema: ${sandbox.schemaName}`);
  console.log(`  Guilds: ${sandbox.guildIds.length}`);
  process.exit(0);
}
```

**Affected Files**:
- `create.ts` (add flag)
- `destroy.ts` (add flag)

---

## Implementation Specification

### Task Breakdown

| Task ID | Task | Effort | Priority |
|---------|------|--------|----------|
| CLI-1 | Add TTY detection for spinners | S | P1 |
| CLI-2 | Add TTY check before prompting | S | P1 |
| CLI-3 | Add `--no-color` flag | S | P1 |
| CLI-4 | Add `NO_COLOR` env var check | S | P2 |
| CLI-5 | Add `--quiet` flag | M | P2 |
| CLI-6 | Add `--dry-run` flag | M | P3 |
| CLI-7 | Unit tests for new flags | M | P1 |

### Acceptance Criteria

#### CLI-1: TTY Detection for Spinners
- [ ] Spinners only display when `process.stdout.isTTY` is true
- [ ] No spinner artifacts in piped output
- [ ] CI logs are clean (no spinner frames)

#### CLI-2: TTY Check Before Prompting
- [ ] `destroy` without `--yes` fails gracefully when stdin is not TTY
- [ ] Error message suggests using `--yes` flag
- [ ] Scripts don't hang waiting for input

#### CLI-3: `--no-color` Flag
- [ ] `bd sandbox --no-color list` shows uncolored output
- [ ] Flag works on all subcommands
- [ ] Spinner symbols still work (just no color)

#### CLI-4: `NO_COLOR` Environment Variable
- [ ] `NO_COLOR=1 bd sandbox list` shows uncolored output
- [ ] `TERM=dumb bd sandbox list` shows uncolored output
- [ ] Non-TTY stdout disables color automatically

#### CLI-5: `--quiet` Flag
- [ ] `bd sandbox create --quiet` only outputs essential info
- [ ] Spinners suppressed in quiet mode
- [ ] Suggestions and hints suppressed
- [ ] JSON output unaffected by `--quiet`

#### CLI-6: `--dry-run` Flag
- [ ] `bd sandbox create --dry-run` shows what would be created
- [ ] `bd sandbox destroy --dry-run foo` shows what would be destroyed
- [ ] No actual changes made in dry-run mode
- [ ] Clear indication that it's a dry run

#### CLI-7: Unit Tests
- [ ] Tests for TTY/non-TTY behavior
- [ ] Tests for `--no-color` flag
- [ ] Tests for `NO_COLOR` env var
- [ ] Tests for `--quiet` flag
- [ ] Tests for `--dry-run` flag

---

## Sprint Recommendation

### Sprint 88: CLI Best Practices Compliance

**Goal**: Bring Discord Server Sandboxes CLI to full clig.dev compliance

**Duration**: 1 sprint (estimated 2-3 days implementation)

**Tasks**:

| ID | Task | Description | Effort |
|----|------|-------------|--------|
| S-88.1 | TTY Detection | Add isTTY checks for spinners | S |
| S-88.2 | Interactive Prompts | Add TTY check before confirmation prompts | S |
| S-88.3 | Color Control | Add `--no-color` flag and `NO_COLOR` env check | S |
| S-88.4 | Quiet Mode | Add `--quiet` flag to all commands | M |
| S-88.5 | Dry Run | Add `--dry-run` to create/destroy | M |
| S-88.6 | Test Coverage | Unit tests for all new functionality | M |

**Definition of Done**:
- [ ] All 6 issues addressed
- [ ] Unit tests for new flags (>90% coverage)
- [ ] Manual testing in TTY and non-TTY environments
- [ ] CI pipeline passes with piped output
- [ ] Compliance score reaches 95/100

**Dependencies**: Sprint 87 (Cleanup & Polish) - COMPLETED

---

## Appendix: clig.dev Reference

### Standard Flags Used Correctly

| Flag | Purpose | Implementation |
|------|---------|----------------|
| `--json` | Machine-readable output | All commands |
| `-a, --all` | Include all items | list command |
| `-y, --yes` | Skip confirmation | destroy command |
| `-w, --watch` | Watch mode | status command |
| `-t, --ttl` | Time-to-live | create command |
| `-o, --owner` | Filter by owner | list command |
| `-s, --status` | Filter by status | list command |

### Standard Flags Missing

| Flag | Purpose | Should Add To |
|------|---------|---------------|
| `--no-color` | Disable colors | Parent command |
| `-q, --quiet` | Suppress output | Parent command |
| `-n, --dry-run` | Preview changes | create, destroy |
| `-v, --verbose` | Extra output | Consider for debugging |

---

**Document Status**: Ready for Sprint Planning
