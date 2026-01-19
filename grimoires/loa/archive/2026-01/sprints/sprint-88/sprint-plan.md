# Sprint 88: CLI Best Practices Compliance

**Sprint ID**: S-SB-5
**Series**: Discord Server Sandboxes
**Status**: PLANNED
**Created**: 2026-01-17

---

## Sprint Overview

### Goal

Bring the Discord Server Sandboxes CLI to full clig.dev compliance by addressing 6 identified issues. Target compliance score: 95/100 (up from 85/100).

### Context

The CLI implementation (Sprints 84-87) is functionally complete but lacks some industry-standard CLI behaviors around TTY detection, color control, and output modes. This sprint addresses these gaps to ensure the CLI works correctly in CI/CD pipelines, scripts, and diverse terminal environments.

### Scope

- **In Scope**: TTY detection, color control, quiet mode, dry-run support, tests
- **Out of Scope**: New commands, functional changes, API modifications

### Duration

Estimated: 2-3 days implementation

### Dependencies

- Sprint 87 (Cleanup & Polish) - COMPLETED

---

## Tasks

### S-88.1: TTY Detection for Spinners

**Priority**: P1 (High)
**Effort**: S (Small)
**clig.dev Reference**: "Disable animations for non-TTY"

#### Description

Add `process.stdout.isTTY` checks before displaying spinners. Currently, spinners run regardless of terminal type, causing corrupted output in CI/CD and piped scenarios.

#### Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/commands/sandbox/create.ts` | Line 51 - conditional spinner |
| `packages/cli/src/commands/sandbox/destroy.ts` | Line 134 - conditional spinner |
| `packages/cli/src/commands/sandbox/status.ts` | Line 152 - conditional spinner |
| `packages/cli/src/commands/sandbox/register.ts` | Line 35 - conditional spinner |
| `packages/cli/src/commands/sandbox/unregister.ts` | Line 35 - conditional spinner |

#### Implementation

```typescript
// Before
const spinner = ora();
if (!options.json) {
  spinner.start('Creating sandbox...');
}

// After
const spinner = process.stdout.isTTY && !options.json
  ? ora('Creating sandbox...').start()
  : null;
```

#### Acceptance Criteria

- [ ] Spinners only display when `process.stdout.isTTY` is true
- [ ] No spinner artifacts in piped output: `bd sandbox list | cat`
- [ ] CI logs are clean (no spinner frames)
- [ ] Functionality unchanged when TTY is present

---

### S-88.2: TTY Check Before Prompting

**Priority**: P1 (High)
**Effort**: S (Small)
**clig.dev Reference**: "Check for TTY before prompting... scripts should use flags"

#### Description

The `destroy` command prompts for confirmation but doesn't check if stdin is a TTY. In non-interactive mode (CI, scripts), the command hangs indefinitely waiting for input.

#### Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/commands/sandbox/destroy.ts` | Line 114 - add TTY check |

#### Implementation

```typescript
// Before
if (!options.yes && !options.json) {
  const confirmed = await confirm(...);
}

// After
if (!options.yes && !options.json) {
  if (!process.stdin.isTTY) {
    console.error(chalk.red('Error: Cannot prompt for confirmation in non-interactive mode.'));
    console.error(chalk.yellow('Use --yes to skip confirmation.'));
    process.exit(1);
  }
  const confirmed = await confirm(...);
}
```

#### Acceptance Criteria

- [ ] `echo "n" | bd sandbox destroy foo` exits with error, not hang
- [ ] Error message clearly suggests using `--yes` flag
- [ ] `bd sandbox destroy --yes foo` works in non-interactive mode
- [ ] Interactive mode (TTY) behavior unchanged

---

### S-88.3: Color Control

**Priority**: P1 (High)
**Effort**: S (Small)
**clig.dev Reference**: "Disable color if NO_COLOR env var is set, TERM=dumb, or user passes --no-color"

#### Description

Add `--no-color` flag and check standard environment variables (`NO_COLOR`, `TERM=dumb`) to disable colored output.

#### Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/commands/sandbox/utils.ts` | Add `shouldUseColor()` helper |
| `packages/cli/src/commands/sandbox/index.ts` | Add `--no-color` flag and preAction hook |

#### Implementation

```typescript
// utils.ts
export function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

// index.ts
const sandbox = new Command('sandbox')
  .description('Manage Discord server sandboxes for isolated testing')
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.noColor || !shouldUseColor()) {
      chalk.level = 0;
    }
  });
```

#### Acceptance Criteria

- [ ] `bd sandbox --no-color list` shows uncolored output
- [ ] `NO_COLOR=1 bd sandbox list` shows uncolored output
- [ ] `TERM=dumb bd sandbox list` shows uncolored output
- [ ] Non-TTY stdout disables color automatically
- [ ] Flag inherited by all subcommands

---

### S-88.4: Quiet Mode

**Priority**: P2 (Medium)
**Effort**: M (Medium)
**clig.dev Reference**: Standard flag `-q, --quiet`

#### Description

Add `--quiet` flag to suppress non-essential output like spinners, suggestions, and formatting. Essential info (created sandbox name, errors) still displayed.

#### Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/commands/sandbox/index.ts` | Add `-q, --quiet` flag |
| `packages/cli/src/commands/sandbox/create.ts` | Respect quiet mode |
| `packages/cli/src/commands/sandbox/destroy.ts` | Respect quiet mode |
| `packages/cli/src/commands/sandbox/status.ts` | Respect quiet mode |
| `packages/cli/src/commands/sandbox/list.ts` | Respect quiet mode |
| `packages/cli/src/commands/sandbox/register.ts` | Respect quiet mode |
| `packages/cli/src/commands/sandbox/unregister.ts` | Respect quiet mode |
| `packages/cli/src/commands/sandbox/connect.ts` | Respect quiet mode |

#### Implementation

```typescript
// index.ts
.option('-q, --quiet', 'Suppress non-essential output')

// create.ts - example
const globalOpts = command.optsWithGlobals();
if (!options.json && !globalOpts.quiet) {
  console.log(chalk.dim('To connect workers to this sandbox:'));
  console.log(chalk.dim(`  eval $(bd sandbox connect ${result.sandbox.name})`));
}

// In quiet mode, only output essential info:
// - Success: sandbox name/ID
// - Error: error message
```

#### Acceptance Criteria

- [ ] `bd sandbox create --quiet` outputs only sandbox name
- [ ] `bd sandbox list --quiet` outputs only table (no totals, no hints)
- [ ] Spinners suppressed in quiet mode
- [ ] Suggestions and hints suppressed
- [ ] JSON output unaffected by `--quiet`
- [ ] Errors still displayed in quiet mode

---

### S-88.5: Dry Run Mode

**Priority**: P3 (Low)
**Effort**: M (Medium)
**clig.dev Reference**: Standard flag `-n, --dry-run`

#### Description

Add `--dry-run` flag to `create` and `destroy` commands to preview actions without executing them.

#### Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/commands/sandbox/create.ts` | Add `--dry-run` flag and logic |
| `packages/cli/src/commands/sandbox/destroy.ts` | Add `--dry-run` flag and logic |

#### Implementation

```typescript
// destroy.ts
.option('-n, --dry-run', 'Show what would be destroyed without doing it')

// In action handler:
if (options.dryRun) {
  if (options.json) {
    console.log(JSON.stringify({
      dryRun: true,
      wouldDestroy: {
        id: sandbox.id,
        name: sandbox.name,
        schemaName: sandbox.schemaName,
        guildIds: sandbox.guildIds,
      },
    }, null, 2));
  } else {
    console.log(chalk.yellow('DRY RUN - No changes will be made'));
    console.log();
    console.log('Would destroy sandbox:');
    console.log(`  Name:   ${chalk.cyan(sandbox.name)}`);
    console.log(`  Schema: ${sandbox.schemaName}`);
    console.log(`  Guilds: ${sandbox.guildIds.length}`);
  }
  process.exit(0);
}

// create.ts - similar pattern
if (options.dryRun) {
  console.log(chalk.yellow('DRY RUN - No changes will be made'));
  console.log();
  console.log('Would create sandbox:');
  console.log(`  Name:   ${name || '(auto-generated)'}`);
  console.log(`  Owner:  ${owner}`);
  console.log(`  TTL:    ${ttlHours} hours`);
  if (options.guild) {
    console.log(`  Guild:  ${options.guild}`);
  }
  process.exit(0);
}
```

#### Acceptance Criteria

- [ ] `bd sandbox create --dry-run` shows what would be created
- [ ] `bd sandbox destroy --dry-run foo` shows what would be destroyed
- [ ] No database changes in dry-run mode
- [ ] No schema created/dropped in dry-run mode
- [ ] Clear visual indication of dry-run mode
- [ ] JSON output works with `--dry-run --json`

---

### S-88.6: Unit Tests

**Priority**: P1 (High)
**Effort**: M (Medium)

#### Description

Add comprehensive unit tests for all new functionality to ensure correctness and prevent regressions.

#### Files to Create/Modify

| File | Change |
|------|--------|
| `packages/cli/src/commands/sandbox/__tests__/tty-detection.test.ts` | NEW - TTY tests |
| `packages/cli/src/commands/sandbox/__tests__/color-control.test.ts` | NEW - Color tests |
| `packages/cli/src/commands/sandbox/__tests__/quiet-mode.test.ts` | NEW - Quiet tests |
| `packages/cli/src/commands/sandbox/__tests__/dry-run.test.ts` | NEW - Dry-run tests |

#### Test Cases

**TTY Detection Tests**:
```typescript
describe('TTY Detection', () => {
  it('should not display spinner when stdout is not TTY', () => {...});
  it('should display spinner when stdout is TTY', () => {...});
  it('should not corrupt output when piped', () => {...});
});
```

**Color Control Tests**:
```typescript
describe('Color Control', () => {
  it('should disable color with --no-color flag', () => {...});
  it('should disable color when NO_COLOR env is set', () => {...});
  it('should disable color when TERM=dumb', () => {...});
  it('should disable color when stdout is not TTY', () => {...});
  it('should enable color by default in TTY', () => {...});
});
```

**Quiet Mode Tests**:
```typescript
describe('Quiet Mode', () => {
  it('should suppress hints in quiet mode', () => {...});
  it('should suppress spinners in quiet mode', () => {...});
  it('should still show essential output in quiet mode', () => {...});
  it('should not affect JSON output', () => {...});
});
```

**Dry Run Tests**:
```typescript
describe('Dry Run', () => {
  it('should not create sandbox in dry-run mode', () => {...});
  it('should not destroy sandbox in dry-run mode', () => {...});
  it('should show preview of what would happen', () => {...});
  it('should work with JSON output', () => {...});
});
```

#### Acceptance Criteria

- [ ] >90% code coverage on new functionality
- [ ] All test cases pass
- [ ] Tests run in CI pipeline
- [ ] No existing tests broken

---

## Definition of Done

### Sprint Completion Criteria

- [ ] All 6 tasks completed
- [ ] All acceptance criteria met
- [ ] Unit tests passing (>90% coverage on new code)
- [ ] Manual testing completed:
  - [ ] TTY environment (interactive terminal)
  - [ ] Non-TTY environment (piped, CI)
  - [ ] `NO_COLOR` environment variable
  - [ ] `TERM=dumb` environment
- [ ] TypeScript compilation passes
- [ ] No regressions in existing functionality
- [ ] clig.dev compliance score reaches 95/100

### Testing Checklist

```bash
# TTY detection
bd sandbox create | cat  # Should not show spinner artifacts
bd sandbox list | grep running  # Clean output

# Non-interactive mode
echo "n" | bd sandbox destroy test  # Should error, not hang
bd sandbox destroy --yes test  # Should work

# Color control
bd sandbox --no-color list  # No colors
NO_COLOR=1 bd sandbox list  # No colors
TERM=dumb bd sandbox list  # No colors

# Quiet mode
bd sandbox create --quiet  # Minimal output
bd sandbox list --quiet  # No hints

# Dry run
bd sandbox create --dry-run  # Preview only
bd sandbox destroy --dry-run test  # Preview only
bd sandbox create --dry-run --json  # JSON preview
```

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking existing scripts | Low | Medium | Comprehensive test coverage |
| Commander.js hook complexity | Low | Low | Use documented APIs |
| chalk level modification side effects | Medium | Low | Set in preAction hook only |

---

## Notes

- This sprint focuses on CLI polish, not new features
- All changes are additive (new flags) or defensive (TTY checks)
- Existing command signatures unchanged for backward compatibility
- Sprint naming continues sandbox series: S-SB-5

---

## References

- [clig.dev](https://clig.dev/) - CLI Guidelines
- Architecture Review: `grimoires/loa/a2a/sprint-88/cli-best-practices-review.md`
- Previous Sprint: Sprint 87 (S-SB-4) - Cleanup & Polish

---

**Document Status**: APPROVED - Ready for Implementation
