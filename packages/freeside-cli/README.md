# packages/freeside-cli/

**Package**: `@freeside/freeside-cli` · **Domain**: network · **Status**: scaffold

Ecosystem CLI for the `freeside-*` module network. Provides `loa freeside <verb>` commands for module discovery, audit, and inspection.

> **Distinct from `packages/cli/`** (`@freeside/cli`, the `gaib` IaC orchestrator for the vertical platform — domain: platform). The doubled `freeside` in the package name disambiguates the two CLIs. See [ADR-007 §D-2](../../decisions/007-loa-freeside-absorption.md) for the naming decision.

## Planned verbs

Per [ADR-007 §D-6](../../decisions/007-loa-freeside-absorption.md):

| Verb | Purpose | Status |
|------|---------|--------|
| `loa freeside doctor` | Audit all `freeside-*` modules against BeaconV3 schema; compliance report | planned (Step 8) |
| `loa freeside list` | Show registered modules with one-liners | planned (Step 8) |
| `loa freeside inspect <slug>` | Show full beacon for a module | planned (Step 8) |
| `loa freeside install <slug>` | Install substrate-runtime modules locally | future cycle |
| `loa freeside new <slug>` | Scaffold new module from `freeside-base` template | **DEFERRED** (per A4 — manual clone-and-rename until 3+ modules built) |

## What lives here

Currently: this README + (forthcoming) a placeholder `package.json` for namespace reservation. Working CLI ships in [ADR-007 §Implementation step 8](../../decisions/007-loa-freeside-absorption.md).

## Forward conflict awareness

[PR #178](https://github.com/0xHoneyJar/loa-freeside/pull/178) (DRAFT) stakes `packages/freeside-cli/` with package name `@freeside/cli`. That collides with `packages/cli/` (gaib) post-rename. Resolution per ADR-007 §D-2: PR #178's package becomes `@freeside/freeside-cli`. Operator + Jani coordinate before either lands.

## Domain boundary

Network path per [ADR-007 §D-3](../../decisions/007-loa-freeside-absorption.md). CI enforced.

## Related

- [ADR-007](../../decisions/007-loa-freeside-absorption.md) — dual-concern absorption
- `packages/cli/` — `@freeside/cli` gaib IaC (platform domain, do not confuse)
- `packages/freeside-registry/` — the registry these CLI verbs query
- `construct-freeside` — operational skills that consume CLI output (`reading-cli-telemetry`, `reading-registry`, `coordinating-cutover`)
