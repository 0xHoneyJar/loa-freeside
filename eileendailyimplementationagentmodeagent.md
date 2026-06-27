# Eileen Daily Implementation Agent Mode Agent

This file is the repo-local runbook for the daily GPT-5.5 Thinking implementation agent. The daily agent prompt must explicitly read this file before editing this repo. This file is intentionally separate from `AGENTS.md`; it is a workflow contract for converting Daily Deep Research Report issues into additive implementation PRs.

## Repository responsibility

`0xHoneyJar/loa-freeside` owns the Freeside product/platform: token-gating, wallet verification, holder intelligence, AI community operations, Discord/Telegram/REST product infrastructure, billing, model budgets, BYOK, x402/crypto payment surfaces, and access/entitlement infrastructure.

This repo is not the place for character voice/persona behavior, Straylight estate semantics, Hounfour schema-only packages, Finn experiment verdicts, Aleph research-précis doctrine, or Arcturus revenue-oracle proofs.

## Existing repo instructions

This repo already has `AGENTS.md`. Follow it together with this file. If there is a conflict, follow the stricter rule. Preserve existing tool rules such as using the repo-approved task/search tools when working locally.

## Eligible input

Only implement from a Daily Deep Research Report issue or follow-up plan-audit issue/comment that contains:

- `PROPOSED_NEXT_LANE_SEED`
- candidate ID
- repo-fit reasoning
- acceptance criteria
- rollback path
- `VERDICT: ACCEPT_PLAN`

If the candidate lacks `VERDICT: ACCEPT_PLAN`, the agent may perform in-run plan audit only for docs, fixtures, tests, or checkers. Product/runtime/payment-sensitive work requires explicit external acceptance.

## Selection rule

Pick at most one candidate per run. Prefer product-safety, observability, access-control, billing-shape, or documentation improvements that do not change default customer behavior.

Priority order:

1. docs-only design gates
2. fixture-only product/access examples
3. test-only coverage
4. checker/validator-only additions
5. default-off adapters or capability quote sketches

## Additive-only policy

Nothing currently working may stop functioning.

Allowed by default:

- new docs
- new examples/fixtures
- new tests
- new validation/checker scripts
- default-off experimental adapters
- design-gate documents for payment/access surfaces

Forbidden without explicit Eileen approval:

- deleting files
- changing live entitlement behavior
- changing default billing/payment behavior
- changing wallet verification semantics
- changing public API routes by default
- production migrations
- broad refactors
- unrelated dependency upgrades
- secrets or real env changes
- sibling repo mutation
- deployment changes
- auto-merge
- closing source issues

## Freeside-specific stop conditions

Stop and return `VERDICT: NEEDS_HUMAN` if the candidate would:

- affect real billing, x402 settlement, NOWPayments, Paddle, or user payment flows
- alter token-gating or wallet verification behavior by default
- change tenant/customer data handling
- change production Discord/Telegram behavior
- introduce product claims that are not backed by implementation evidence

## Implementation steps

1. Read `AGENTS.md`, this file, README/package scripts, and relevant docs near the target surface.
2. Inspect the source issue and confirm `VERDICT: ACCEPT_PLAN`.
3. Check for obvious duplicate open issues/PRs.
4. Write a short plan: selected candidate, implementation class, allowed files, forbidden surfaces, checks, rollback.
5. Create a branch named `daily-impl/YYYY-MM-DD-loa-freeside-<candidate>`.
6. Implement exactly one candidate with a minimal diff.
7. Run relevant checks from the repo.
8. Open a draft PR.
9. Add `CODEX AUDIT REQUEST` to the PR body.
10. Comment: `@codex review for additive-only scope violations, accidental default-behavior changes, payment/access-control regressions, failing or missing tests, rollback clarity, repo-boundary violations, and security regressions`.
11. Do not merge and do not close the source issue.

## PR body requirements

The PR must include:

- source issue
- candidate ID
- implementation class
- what changed
- what did not change
- checks run
- skipped or failing checks
- rollback path
- Codex audit request

## Final run report

Report the selected repo, source issue, branch, PR URL, files changed, checks run, Codex review status, blockers, and whether any boundary was approached.
