# @freeside/cli (freeside)

> World-hosting CLI for the Freeside ECS substrate. Placeholder scaffold — working bash reference lives at [sprawl-world/scripts/freeside](https://github.com/0xHoneyJar/sprawl-world/blob/main/scripts/freeside).

**Status**: DRAFT · not yet implemented in this directory · reference bash exists · cycle-010 scaffold staking out the eventual home.

## Why this directory exists

Cycle-010 (2026-04-24) shipped a working bash CLI at `sprawl-world/scripts/freeside` that collapses cycle-009's hand-authored world-provisioning into `freeside world create <name>`. The bash is the concrete primitive; this TypeScript/commander home is the proposed forward migration so the CLI lives as a publishable package alongside [`@arrakis/cli`](../cli/) (gaib) and becomes composable with a future `freeside-mcp` server per the [mcp-wraps-cli pattern](~/hivemind/wiki/concepts/mcp-wraps-cli-pattern.md).

## Naming lineage (read before renaming anything)

- **`gaib`** (shipped, `@arrakis/cli` v0.1.0) — declarative Discord IaC by Jani. `gaib login/sandbox/server`. Cycle-007 complete.
- **`freeside`** (cycle-010, bash reference) — world-hosting CLI by operator. `freeside world create`. Discord-IaC scope NOT touched.

The name `gaib` was coined under Arrakis (Freeside's old name) and drifted onto Jani's Discord tool after the product rename. The operator's preferred end-state (pending Jani review and confirmation) is a **unified `freeside` binary** that subsumes gaib's subverbs:

```
$ freeside login                     # inherits from gaib
$ freeside sandbox new               # inherits from gaib
$ freeside server apply              # inherits from gaib (Discord IaC)
$ freeside world create mibera       # added cycle-010
$ freeside discord apply             # possible alias of `server`
```

This reduces external-facing CLI namespace to one binary (Vercel/vercel parity) while preserving every scope currently shipped. The rename is **Jani's call**.

## What this scaffold is, and isn't

**Is**:
- A placeholder directory so the `@freeside/cli` namespace is staked out in loa-freeside.
- A signpost: future TypeScript/commander implementation migrates from `sprawl-world/scripts/freeside`.
- A concrete destination Jani can fill in, review, or delete if the preferred path is different.

**Is NOT**:
- A working binary. The bash at `sprawl-world/scripts/freeside` is the only working CLI today.
- A premature commitment to the rename. If Jani prefers siblings, rename this package to something else or discard.
- A test suite, release automation, or publishing config. Those land cycle-011+ after the rename decision.

## Migration path (cycle-011+ proposal)

1. Port the bash template-emission functions to TypeScript, one verb at a time (`world create` first).
2. Add vitest suites for (a) dry-run determinism (byte-identical across runs) and (b) template-substitution correctness (CLI output matches cycle-009 hand-authored artifacts up to name tokens).
3. If Jani accepts the unified-binary rename: fold `@arrakis/cli` subverbs into this package as commander subcommands; `gaib` binary stays as a thin backwards-compat shim that rewrites args to `freeside <same-args>`.
4. Publish `@freeside/cli` to the internal npm registry.
5. Ship `@freeside/mcp` as the CLI-wrapping adapter per [mcp-wraps-cli-pattern](~/hivemind/wiki/concepts/mcp-wraps-cli-pattern.md).

## Until then, use the bash

```bash
# From a sprawl-world checkout
./scripts/freeside world create mibera2 --dry-run
./scripts/freeside world create mibera2 --pr
```

See `scripts/freeside help` for full flags.

## Related

- cycle-010 SEED — `loa-constructs/grimoires/loa-constructs-seed-2026-04-21/cycle-010-SEED-freeside-cli-ui-substrate.md`
- `~/hivemind/wiki/freeside-vision.md` §"Add One File, Get a World" (naming lineage footnote)
- `~/hivemind/wiki/concepts/mcp-wraps-cli-pattern.md` §Current state
- `~/hivemind/wiki/concepts/naming-drift-hygiene.md`
- loa-freeside#176, #177 (cycle-009 disclosure + terraform DRAFT)
