# Eileen Daily Implementation Agent Mode Agent

This is the repo-local runbook for the daily GPT-5.5 Thinking implementation agent. The daily agent prompt must explicitly read this file before editing this repo. The agent must first explain what should be implemented, why it matters, why it fits this repo, how it advances the repo endgame, and how the implementation remains safe at scale.

## Repository responsibility

`0xHoneyJar/loa-freeside` owns the Freeside product/platform: token-gating, wallet verification, holder intelligence, AI community operations, Discord/Telegram/REST product infrastructure, billing, model budgets, BYOK, x402/crypto payment surfaces, and access/entitlement infrastructure.

This repo is not the place for character voice/persona behavior, Straylight estate semantics, Hounfour schema-only packages, Finn experiment verdicts, Aleph research-précis doctrine, or Arcturus revenue-oracle proofs.

## Existing repo instructions

This repo also has `AGENTS.md`; follow it together with this file. If there is a conflict, follow the stricter rule.

## Eligible input

Only implement from a Daily Deep Research Report issue or follow-up plan-audit item with `PROPOSED_NEXT_LANE_SEED`, candidate ID, repo-fit reasoning, acceptance criteria, rollback path, and `VERDICT: ACCEPT_PLAN`.

Without `VERDICT: ACCEPT_PLAN`, the agent may self-audit only docs, fixtures, tests, or checkers. Product/runtime/payment-sensitive work requires explicit external acceptance.

## Mandatory pre-implementation thesis

Before editing, write this in the run log and later carry it into the PR body:

1. Candidate chosen: issue, candidate ID, and verdict.
2. What should be implemented: precise change, not a vague theme.
3. Why this should be implemented now: source evidence plus current repo state.
4. Why this belongs in `loa-freeside`: repo-fit and why sibling repos should not own it.
5. What this is good for: customer/product/platform leverage.
6. Why this approach should work: mechanism, expected behavior, and proof path.
7. Endgame contribution: how this moves Freeside toward scalable agentic community infrastructure.
8. Creative/innovative extension path: future lanes after this PR, clearly marked as future work.
9. Mass-user scaling impact: cost, latency, tenant isolation, queue/backpressure, rate-limit, billing, and ops impact.
10. Security scope: auth, wallet, entitlement, payment, tenant data, secret, webhook, and API trust boundaries.
11. Simplification / exploit-prevention argument: how the change avoids complex or fragile surfaces.
12. Non-goals and forbidden surfaces.
13. Tests/checks and rollback path.

If the agent cannot complete this thesis convincingly, it must not implement.

## Additive-only policy

Nothing currently working may stop functioning.

Allowed by default: new docs, examples, fixtures, tests, validators/checkers, default-off experimental adapters, and design-gate documents for payment/access surfaces.

Forbidden without explicit Eileen approval: deleting files, changing live entitlement behavior, changing default billing/payment behavior, changing wallet verification semantics, changing public API routes by default, production migrations, broad refactors, unrelated dependency upgrades, secrets or real env changes, sibling repo mutation, deployment changes, auto-merge, or closing source issues.

## Freeside-specific stop conditions

Stop and return `VERDICT: NEEDS_HUMAN` if the candidate would affect real billing/x402/NOWPayments/Paddle/user payment flows, alter token-gating or wallet verification by default, change tenant/customer data handling, change production Discord/Telegram behavior, or introduce product claims not backed by implementation evidence.

## Implementation steps

1. Read `AGENTS.md`, this file, README/package scripts, and relevant docs near the target surface.
2. Confirm the source item has `VERDICT: ACCEPT_PLAN`.
3. Check for obvious duplicate open issues/PRs.
4. Write the mandatory pre-implementation thesis.
5. Create a branch named `daily-impl/YYYY-MM-DD-loa-freeside-<candidate>`.
6. Implement exactly one candidate with a minimal diff.
7. Prefer simpler code and explicit checks over clever abstractions.
8. Run relevant checks.
9. Open a draft PR.
10. Add `CODEX AUDIT REQUEST` and the required traceability report.
11. Comment: `@codex review for additive-only scope violations, accidental default-behavior changes, payment/access-control regressions, scaling risks, security regressions, exploit-prone complexity, failing or missing tests, rollback clarity, and repo-boundary violations`.
12. Do not merge and do not close the source issue.

## Required PR traceability report

Every implementation PR must include source issue and candidate ID, pre-implementation thesis summary, what changed with file-by-file rationale, why each changed file is good for this repo, why it advances the repo endgame, why it should work, mass-user scaling analysis, security scope and exploit-prevention analysis, simplicity analysis, tests/checks, skipped checks, rollback path, future creative/innovative solution paths not implemented, and `CODEX AUDIT REQUEST`.

## Final run report

Report selected repo, source issue, branch, PR URL, files changed, checks run, Codex review status, blockers, and boundaries approached.
