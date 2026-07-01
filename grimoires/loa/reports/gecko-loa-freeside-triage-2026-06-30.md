---
report: GECKO loa-freeside PR/issue triage
repo: loa-freeside
date: 2026-06-30
construct_party: GECKO · KEEPER · HIVEMIND · KRANZ
tile: drift|CI-ROOT-BLOCKED|rotting-pr-stack
---

# GECKO — loa-freeside triage (2026-06-30)

**One-line verdict: `MISMATCH` — 27/30 open PRs red on shared CI roots, not on their diffs.** NPM Security Audit (12 packages), sietch unit-test deps, and legacy monorepo audit debt block a mergeable-but-ready security/network stack. Wave 1 fix PR **#404** clears worker Security audit, adapters typecheck, drizzle GHSA in sandbox, redis-cli agent-ci, and opossum vitest SSR — partial unblock only.

## TOP findings (ranked)

**1 · MISMATCH — single CI root blocks ~23 PRs**

NPM Security Audit fails across `apps/gateway`, `apps/ingestor`, `apps/mcp-gateway`, `packages/adapters`, `packages/cli`, and others — not per-PR regressions. Matches issues **#399** (drizzle GHSA) plus broader transitive debt (fast-xml-parser, ws/viem, undici).

→ *Remediation:* **#404** (merged first); follow-on audit sweep on remaining 12 packages.

**2 · SIGNAL — consolidation reduced duplicate churn**

Closed superseded PRs: **#391**, **#392**, **#394** (Node 22 → **#404**), **#381** (ensemble dup of **#380**), **#310** (opossum → **#404**). **#382** remains CONFLICTING — rebase after **#395** merge.

**3 · STATUS(progress) — agent-ci typecheck unblocked**

**#398** redis-cli install landed. Core build step added before adapters typecheck — `@freeside/core/ports` resolves. Unit tests still fail on sietch theme missing deps (pre-existing).

**4 · SIGNAL — security stack mergeable, staged**

**#376** (beacon rename), **#388** (SSRF), **#390** (takeover gate), **#389** (cutover floor) are MERGEABLE but NPM-red. KRANZ merge order posted: **#404 → #376 → #388 → #390 → #389**.

**5 · STATUS(fixed-path) — Fable BB outage**

**#402** fix PR **#406**: claude-headless fable→opus retry + ChevalDelegateAdapter opus fallback.

## Field matrix (top ~20)

| ID | Plane | KEEPER bin | CI / state | Next action |
|----|-------|------------|------------|-------------|
| **#404** | P3 | Sweep now | Worker audit ✅; NPM audit ❌ | Merge when audit green enough; unblocks stack |
| **#376** | P1 | Sweep now | MERGEABLE, NPM-red | Merge after #404 |
| **#388** | P2 | Sweep now | MERGEABLE, NPM-red | Security merge wave |
| **#390** | P2 | Sweep now | MERGEABLE, NPM-red | Security merge wave |
| **#389** | P2 | Sweep now | MERGEABLE, NPM-red | Security merge wave |
| **#380** | P2 | Sweep now | agent-ci + NPM | Keep; #381 closed as dup |
| **#382** | P2 | Operator decide | CONFLICTING | Rebase onto main post-#395 |
| **#406** | P2 | Sweep now | NEW | Merge #402 fix (.claude domain) |
| **#366** | P3 | Clarification | WIP audit doc | Defer |
| **#398** | P3 | Sweep now | Fix in #404 | Close when #404 merges |
| **#399** | P3 | Sweep now | Partial in #404 | Close when #404 merges |
| **#400** | P3 | Sweep now | opossum in #404 | Close when #404 merges |
| **#402** | P3 | Sweep now | Fix #406 | Close when #406 merges |
| **#379** | P1 | Sweep now | Closed | Fixed on #376 branch |
| **#403** | P3 | Sweep now | Documentation | Cross-repo dupes (sonar/score/worlds) |
| **#375**, **#386** | P3 | Clarification | RFC | Close when CI wave done |
| **#369**, **#385**, **#393** | discovery | Let it cook | Stale daily research | Batch archived |
| **#315**, **#312**, **#308** | mixed | Sweep/close | Shared CI red | Rebase or close if superseded |

## Convergence metrics

| Metric | Before (Wave 0) | After (Wave 5) |
|--------|-----------------|----------------|
| Open PRs (window) | 25 | 30 (includes #404, #406) |
| PRs with NPM Security Audit failure | ~23 | ~27 (monorepo-wide debt) |
| Duplicate PRs closed | 0 | 5 (#391, #392, #394, #381, #310) |
| Shared-root fix PRs opened | 0 | 2 (#404 platform, #406 .claude) |
| Bug-queue issues with fix PR | 0 | 4 (#398–400→#404, #402→#406) |
| Worker Dependency Audit (moderate+) | FAIL | **PASS** on #404 branch |

## Construct party notes

- **GECKO:** 3-plane classification complete; rotting-pr-stack pattern confirmed.
- **KEEPER:** Sweep-now items routed to fix PRs; research RFCs left queued.
- **HIVEMIND:** `triage-sweep.sh --apply --limit=25` ran Wave 0; #398–400 mislabeled `operator` — relabel to `bug` recommended.
- **KRANZ:** Merge-order comments posted on #404, #376, #388, #389, #390.

## Deliverables

- This report: `grimoires/loa/reports/gecko-loa-freeside-triage-2026-06-30.md`
- Triage manifest: `.run/hivemind/triage-manifest.json`
- Fix PRs: [#404](https://github.com/0xHoneyJar/loa-freeside/pull/404), [#406](https://github.com/0xHoneyJar/loa-freeside/pull/406)
