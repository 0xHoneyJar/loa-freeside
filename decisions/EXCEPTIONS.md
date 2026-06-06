# ADR Exceptions Ledger

Audit home for single-use bypasses of BINDING rules. Referenced by CLAUDE.md
Hard rule 6 and `.github/workflows/path-domain-check.yml`. Created 2026-06-04 to
close a dangerous ghost: the doctrine named this file as the bootstrap-bypass
audit home, but it did not exist (a second bypass would have had no recording
place).

## Schema

Each entry records a sanctioned exception to a BINDING Hard rule:

| Field | Meaning |
|-------|---------|
| `date` | when the exception was taken |
| `rule` | which Hard rule was bypassed (e.g. `adr-007-bootstrap`, `no-cross-domain-PR`) |
| `pr_or_commit` | the PR # / commit SHA carrying the bypass |
| `justification` | why the bypass was necessary |
| `adr_amendment` | the ADR amendment that authorizes it (required for any non-original use) |
| `operator_signoff` | the operator who signed the exception |

## Entries

(none)

> The original `adr-007-bootstrap` workspace-creation PR used the single-use
> bypass before this ledger existed; per CLAUDE.md Hard rule 6, any **subsequent**
> `adr-007-bootstrap` use requires an entry here **plus** an ADR amendment.
