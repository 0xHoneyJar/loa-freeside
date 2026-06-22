# Sprint Plan — Shadow Access Audit (dogfood-NFT magnet) · Sprint 1 (MVP)

> **Cycle**: connecting-surface · traces to `grimoires/loa/sdd.md` + `prd.md` (v2.1).
> **Branch**: feat/shadow-access-audit (worktree). **Goal**: a runnable dogfood-NFT audit on the 8 sonar collections + our roles, passing PRD §6.5 acceptance criteria. **Out of scope**: external/arbitrary contracts, shadow-mode/D4, products 2-4 (SDD §9).

## Sprint 1 tasks (schema-first; each verifies against a PRD acceptance criterion)

| ID | Task | Verification (AC) | Deps |
|----|------|-------------------|------|
| **S1-T1** | Sealed Zod schemas: `Order`, `AccessDecisionRecord` (`packages/protocol/shadow-audit/`) | unit: parse/reject fixtures; `band` enum stale\|missing\|ok; no numeric score field | — |
| **S1-T2** | `SonarClient` (`packages/adapters/sonar/`): belt-gateway GraphQL; `ownershipAtBlock(collection, block)` via Transfer replay; `holderDiff(snapshot, head)` | **AC-1**: fixture collection @ known block → exact holder set; **AC-2**: date→block deterministic | T1 |
| **S1-T3** | `ScoreProxy` (`packages/adapters/score/`): server-side proxy to score-api `/v1/wallets/:address`; circuit-breaker + timeout | **AC-6**: static key never in client payload; breaker trips under timeout | T1 |
| **S1-T4** | `EligibilityResolver`: single-contract NFT balance-threshold band; **refuse** non-NFT/multi/LP/staked gating | **AC-3**: out-of-scope gating → typed refusal, never approximated | T1 |
| **S1-T5** | `ModeResolver` + `RoleSnapshot`: dogfood-full vs external→refuse; snapshot freshness → uncertainty label | **AC-5**: mode deterministic; stale snapshot labels findings uncertain | T1 |
| **S1-T6** | `AuditService`: orchestrate (date→block → ownership@block → diff → stale∩roles → bands → aggregate); pure, no member persistence | composes T2-T5; returns `{aggregate, records?, cta}` | T2,T3,T4,T5 |
| **S1-T7** | API route (`apps/gateway`): `GET /v1/audit` (anon=aggregate, named=`AssociationVerifier` sig+community-binding); `POST /v1/audit/{reaction,contact}`; per-IP rate-limit | **AC-4**: anon never gets named wallets; named requires sig bound to community; **AC-6**: rate-limit | T6 |
| **S1-T8** | `EventStore` (`apps/worker` migration): append-only run-events + consented contact; retention window | unit: append; consent required for contact; no member holdings stored | T1 |
| **S1-T9** | Dashboard route (thin): public audit + reaction capture ("does this match what you expected?") + dual CTA (product + conversation) | renders aggregate; gates named behind sig; fires reaction → EventStore | T7,T8 |

## Sequencing
T1 (schemas) → [T2, T3, T4, T5, T8] (parallelizable) → T6 (service) → T7 (API) → T9 (UI).

## Definition of done (Sprint 1)
All §6.5 acceptance criteria (AC-1..6) pass; the dogfood audit runs end-to-end against a real THJ collection (e.g. a HoneyJar) at a chosen snapshot; the static score key is server-side only; draft PR opened on feat/shadow-access-audit. **No** member-data persistence, role writes, numeric score, or external-contract support.

## Risks (from PRD §7, design-mitigated in SDD §10)
historical-at-block (resolved — reconstructable for the 8 collections) · wrong confront-number (sealed rule + refusal) · DoS/key-leak (proxy + rate-limit) · confirm-by-construction (the interview is the falsifier, out of code scope).
