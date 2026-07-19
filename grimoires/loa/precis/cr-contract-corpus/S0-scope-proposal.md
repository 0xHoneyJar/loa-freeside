---
status: awaiting-operator-S0-ruling
date: 2026-07-19
run_mode: manual (fixture-labeled — no attested host on this machine; see brief)
trust_tier: ai-derived
read_state: unread
use_label: use_as_background_only
taint: fixture-simulated
related:
  - ../../context/2026-07-19-precis-pipeline-brief.md (adopted wiring conventions)
---

# S0 scope proposal — Collection-Report (CR) contract corpus précis

> Prepared for the operator's S0 authority ruling. Per Aleph S0, only the
> operator can rule: scope, exclusions, per-source sensitivity, authority
> identity, freeze decision. Nothing below is frozen until ruled.

## Why this corpus (one line)

The six v1.0.0 protocol packages ship 79 TypeScript files and 2 markdown files
— the contract rationale exists ONLY in commits, PR reviews, and scattered
briefs; when the coordinator sessions fade, "why each invariant exists" is gone.

## Proposed corpus scope (5 source families)

| # | Family | Extent (verified 2026-07-19) | Provenance class |
|---|--------|------------------------------|------------------|
| 1 | Merged PR trail (titles, bodies, review threads incl. Bridgebuilder) | ~29 merged PRs, CR-001…CR-208 visible (#473, #475, #476, #480, #488, #489, #491, #495, #496, #497, #498, #499, #500, #501, #502, #503 …) — needs gh export to freeze | mixed: operator_input + model_output (reviews MUST be tagged model_output) |
| 2 | CR-coded commit messages | 44 commits matching `CR-` on all branches | operator/agent authored |
| 3 | Rationale docs | `grimoires/loa/context/2026-07-03-collections-sot-direction.md`, `2026-07-10-shadow-audit-collection-registry.grounded.md`, `2026-06-28-shadow-audit-belt-dag-subway-ordering.md`; `decisions/009-freeside-hexagonal-federation.md`; PR #473 boundary-acceptance doc | operator-reviewed |
| 4 | In-package contract truth | `packages/protocol/{collection,collection-resolution,dependency-ledger,public-authorization,signing-key-custody,trust-envelope}` (74 .ts, 2 .md) + `packages/collection-report-gates` (5 .ts); 138 files repo-wide carry CR- codes | code = ground truth (claims cite file:line) |
| 5 | Fresh secondary | `grimoires/loa/ground-truth/{contracts,architecture}.md` @ b5df718a (2026-07-19 ride) | ai-autogen, checksummed |

## Proposed exclusions (with reason)

- `packages/protocol/{shadow-audit,shadow-mode,eligibility,ordering}` at 0.x —
  different maturity lane; ordering RUNTIME is a consumer, not contract corpus
  (its 24 Hono routes cite the contracts; include only cited lines as evidence).
- `2026-07-13-member-legibility-collection-mirror.md` — adjacent corpus
  (member-identity précis candidate #2, queued separately).
- `grimoires/loa/reality/*` — derived artifacts; would double-count sources.
- Coordinator branch working commits not merged to main — unratified.

## Sensitivity proposal (per-source)

All sources are org-private repo content. No PII observed. Bridgebuilder review
bodies are model outputs — carry `provenance.source_type: model_output`, never
operator authority. No secrets in scope (contract code only; no .env/infra).

## Freeze proposal

- Git: main @ merge-base of this session's branch (or operator-named SHA).
- PR trail: `gh pr list/view` export taken at ruling time, stored under
  `corpus/` as immutable snapshot — PRs are external referents (S8 class).

## Open questions for the operator (the S0 ruling)

1. Scope: families 1–5 as proposed, or narrower (e.g. drop family 5)?
2. Exclusions: confirm the four above?
3. Sensitivity: confirm org-private / no-redaction, or name redactions?
4. Authority identity for acceptance gates (S13): you, or delegate?
5. Freeze: which SHA + snapshot date?
