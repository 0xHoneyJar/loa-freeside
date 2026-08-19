# Sprint Plan — Thin Hub Extraction

**Version:** 1.0  
**Date:** 2026-07-17  
**Cycle:** thin-hub-extraction  
**PRD:** `grimoires/loa/prd.md` (G-1..G-7) · **SDD:** `grimoires/loa/sdd.md`  
**Prior sprint archived:** `sprint.shadow-audit-mvp.md`

> **Spine = G-1** — billing edge live over **one** credit SoT (finn cure).  
> Mediums renamed → **integrations-api** (provider ingestion); sietch bot peel is separate.  
> **G-7 AWS scrub is in-scope** (not optional hygiene).

Domain labels: platform vs network per ADR-007 — **no cross-domain PRs**.

---

## Sprint Overview

| Sprint | Theme | Goals | Domain |
|--------|-------|-------|--------|
| **S1** | Public AWS account scrub (`AWS_ACCOUNT_ID_REDACTED`) | G-7 | platform (docs/IaC) |
| **S2** | Registry: `mediums-api` → `integrations-api` (#469) | G-3 | network |
| **S3** | Mount BYOK admin + egress HTTP | G-4 | platform |
| **S4** | Billing edge spike — finn finalize/health against single credit SoT | G-1 | network / billing-api |
| **S5** | Hub freeze + dual-rail inventory beads (NOWPayments/x402 Shadows) | G-6 | platform |

Ordering: S1 can parallel S2. S3 after S1 start. S4 is spine (may touch `billing-api` repo). S5 documents delete-later list only.

Definition of green (hub): `oxlint` / relevant package tests green; no secrets in diff; path-domain check passes.

---

## Sprint 1: AWS account scrub (G-7)

**Goal:** Remove plaintext AWS account `AWS_ACCOUNT_ID_REDACTED` from committed public surfaces in loa-freeside.

| Task | Detail | Acceptance |
|------|--------|------------|
| S1-T1 | Inventory all hits (excl. worktrees/node_modules) into `grimoires/loa/reality/aws-account-scrub-inventory.md` | Inventory lists path:line for each hit |
| S1-T2 | Replace plaintext account digits with `AWS_ACCOUNT_ID_REDACTED` / env-var references | Search for the former 12-digit account ID returns 0 in primary tracked paths (excl. `.worktrees` / `.ck` caches) |
| S1-T3 | Note sibling early loa repos (ES thread) as follow-up beads — do not scrub other repos in this PR unless operator expands | Bead filed or NOTES entry |

**Out of scope:** Changing live AWS resources; rotating credentials.

---

## Sprint 2: Registry integrations migration (G-3 / #469)

**Goal:** loa-freeside registry truth matches GitHub `integrations-api`.

| Task | Detail | Acceptance |
|------|--------|------------|
| S2-T1 | Update `packages/freeside-registry/registry.yaml`: slug/git_url/notes for ex-mediums → integrations-api | `git_url` = `https://github.com/0xHoneyJar/integrations-api.git`; notes cite wave-1 non-prod + medium-registry preserved |
| S2-T2 | Update CLAUDE.md / ADR-008 orientation refs that still say mediums-only if they claim live HTTP | No claim that mediums-api is the live cell name |
| S2-T3 | Close or comment [loa-freeside#469](https://github.com/0xHoneyJar/loa-freeside/issues/469) with evidence | Issue updated |

**Do not:** claim production Discord ingestion until durable-store gate lands in integrations-api.

---

## Sprint 3: Mount BYOK (G-4)

**Goal:** Wire existing BYOK admin + `BYOKProxyHandler` to live HTTP (or document fail-closed reason).

| Task | Detail | Acceptance |
|------|--------|------------|
| S3-T1 | Mount admin BYOK routes in sietch `server.ts` / admin router behind auth | `POST/GET` admin BYOK reachable in test harness |
| S3-T2 | Mount S2S BYOK egress proxy route for loa-finn callback | Route exists; SSRF allowlist still enforced; unit tests green |
| S3-T3 | Feature-flag if needed (`BYOK_ENABLED`) — default off in prod until operator flips | Flag documented in env reality |

Product frame: inference provider keys only (OpenAI/Anthropic); CRM AWS/Dune keys → integrations later.

---

## Sprint 4: Billing edge spine (G-1)

**Goal:** One live finn finalize path against **single** credit SoT — no second ledger.

| Task | Detail | Acceptance |
|------|--------|------------|
| S4-T1 | Confirm `billing-api` repo shape vs delegating-edge brief (`2026-06-21-billing-ledger-edge-design-brief.md`) | Written verdict in NOTES: edge vs own-ledger; block deploy if second ledger |
| S4-T2 | Spike: health + finalize contract match loa-finn client | Contract table in SDD addendum or NOTES with file:line |
| S4-T3 | Operator checkpoint before any production URL flip | AskUserQuestion / explicit NOTES gate — no silent cutover |

**NG-1:** do not edit payment rail code this sprint unless Eileen gate lifted.

---

## Sprint 5: Freeze + Shadow inventory (G-6)

**Goal:** Stop growth; catalog DELETE-CANDIDATEs for later.

| Task | Detail | Acceptance |
|------|--------|------------|
| S5-T1 | Bead list: dual NOWPayments, dual x402, unmounted `packages/routes` webhooks, nested sietch packages | `br` issues with domain labels |
| S5-T2 | NOTES freeze rule: no new feature in sietch billing/bots except firefixes + extraction seams | NOTES entry |

---

## Out of scope this plan

- Full sietch → worlds extraction
- ledger-api crypto bridge (forbidden)
- Deleting Spice Gate
- Production integrations-api durable store (lives in integrations-api repo)
- Completing shadow-audit MVP product spine (archived cycle)

---

## Bridge readiness

After S1–S3 land on this branch with a DRAFT PR, `/run-bridge --depth 3` reviews the diff. S4 may be design-only in first bridge pass if billing-api access is gated.
