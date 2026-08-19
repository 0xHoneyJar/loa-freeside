# Security Audit — sprint-bug-419

**Initial verdict: CHANGES_REQUIRED (1 HIGH, privacy).**
**Post-fix verdict: APPROVED - LETS FUCKING GO**

Audited as a **privacy change**, because that is what it is: the aggregate now publishes coverage
information on the anonymous `GET /v1/audit` response, and the fix added a new refusal that talks about
cohort sizes in prose.

> **Provenance**: this file could not be written during the `/audit-sprint` turn — the harness strips
> `Write`/`Edit` while a review/audit skill is active (loa#1195). The verdict was carried in-conversation
> and persisted from the follow-up `/implement` turn.

---

## HIGH-1 — the REFUSAL path bypassed the k-anonymity the SUCCESS path enforces — **FIXED**

**Introduced by this sprint's own fix.** The irony is the finding: C-2 hardened the success channel
against back-computation, and the same commit leaked the same class of number through the failure
channel, in plain prose.

`mode-resolver.ts` built the `role-coverage-too-low` reason with **exact** counts, and that string is
returned **verbatim** to callers (`http/audit-router.ts:316`, `:340` — `c.json({ error: result.refusal })`).

**Demonstrated** (not asserted) — an operated community with `total=6`, `matched=2`:

```
"only 2 of 6 role-holders could be resolved to a wallet (33% coverage; the floor is 50%)."

  ⇒ unmatched = 6 − 2 = 4        ← an EXACT sub-k cohort (k=5)
  the SUCCESS path publishes exactly that as {"kind":"bucketed","bucket":"<5"}
```

Three distinct leaks in one string:

1. **Exact sub-k numerator** — `matched=2` is itself a cohort below k.
2. **Exact sub-k complement** — `unmatched = total − matched` is trivially derived.
3. **The rounded percentage** — beside an exact denominator, `33%` *re-derives* the numerator.
   "Rounding is not suppression" — the identical BB-4 / `access-risk.ts` lesson, re-broken in a new channel.

For thj specifically: `matched=1` is a **cohort of one** — "exactly one person in your guild is linked" —
precisely the disclosure k-anonymity exists to prevent.

**A failure channel that discloses what the success channel hides is not a smaller leak, just a quieter one.**

### Resolution (`mode-resolver.ts:84-131`)

Mirrors the codebase's own doctrine rather than inventing a new rule:

- `k` is now threaded into `resolveMode` (`ModeContext.k`, defaulting to `DEFAULT_K`), and
  `audit-service.ts:99` passes `deps.k` — so **the refusal and the aggregate suppress to the SAME k**.
- The matched numerator is k-anonymized through the existing `kAnonCohort`: exact only when `>= k`,
  otherwise the bucket ("fewer than 5 of your 515 role-holders could be resolved").
- The **true ratio is emitted only when the numerator is exact**. When suppressed, the reader gets the
  floor comparison ("below the 50% coverage floor") and *no* true-ratio-derived number at all.
- The denominator stays exact — it is a role-size, and `access-risk.ts` publishes its denominator
  (`qualified_at_snapshot`) exactly for the same reason.
- **A role set smaller than k cannot be reported on at all** — publishing the denominator would itself
  expose a sub-k cohort. That now returns the *existing* `cohort-too-small` refusal.
- The message stays **actionable** — it is the sales conversation ("link the missing members — or import
  them from your incumbent — and re-export"). Suppression, not neutering.

**Verified**: 4 new tests (`mode-and-role.test.ts`), including a **false-positive guard** (an exact `>= k`
numerator keeps its counts — we must not over-suppress the honest case). **Mutation-tested**: reverting
the suppression makes both leak tests fail.

---

## Attack surface reviewed — no further findings

| # | Attack | Verdict |
|---|---|---|
| 1 | Back-compute a suppressed cohort from `role_coverage` + `unmatched_role_holders` + `coverage_uncertain` | **Blocked.** The `superRefine` (C-2) forbids a true ratio beside a suppressed cohort. The sole exemption — `role_coverage === 1` — reveals only `unmatched === 0`, an **empty** cohort that identifies nobody. Not exploitable. |
| 2 | The `role_coverage === null` ⇒ `unmatched ∈ [1,k)` residual | **Accepted.** Narrows the published `<k` bucket from `{0..k-1}` to `{1..k-1}`. Discloses **existence** ("at least one member is unlinked"), never **identity**. k-anonymity holds. Documented in `audit-output.ts:62-67` rather than pretended away. |
| 3 | `coverage_uncertain` (a boolean over a public threshold) bounding the total role count | **Accepted.** Coarse, and a Discord role's member count is already visible to guild members. Leaks nothing an attacker with guild access doesn't hold. |
| 4 | Refusal-path k-anon bypass | **WAS THE BUG** — see HIGH-1. Fixed. |
| 5 | `role-coverage-too-low` as a new enumeration oracle | **No.** `isOperatedCommunity` is checked *first* (`mode-resolver.ts:56`), so a non-operated community gets `external-mode` and never reaches the coverage branch; the contract must also be in `COLLECTION_REGISTRY` (route gate). No new probe surface across communities or contracts. |

**Secrets / PII**: the refusal carries no wallets and no discord ids — only counts. The exporter redacts
every identifier before logging (`first4…last4`), and the ingest token is read from env, never logged.
No PII in any response body or log line introduced by this sprint.

**Public teaser**: `/v1/access-risk` is role-**independent** (`computeAccessRisk` never calls
`resolveMode`) and was **verified live** post-deploy — still returns the real on-chain risk
(`qualified_at_snapshot: 1813`). The lead-magnet's public door stays open while the authed audit honestly
refuses. That is the intended product shape: the refusal *is* the sales conversation.

## Verification

| Check | Result |
|---|---|
| `@freeside/shadow-audit-service` | **222 pass**, tsc clean |
| `@freeside/shadow-audit-protocol` | 53 pass, tsc clean |
| Mutation test (revert suppression) | 2 leak tests **fail** — the guard has teeth |
| False-positive guard | exact `>= k` numerator keeps counts + percentage |
| Live re-probe (post-deploy) | thj still `422 role-coverage-too-low`, size-1 cohort **suppressed** |

## Standing note for the next auditor

This sprint's two most serious findings — the unenforced schema invariant (C-2) and this refusal-path
bypass (HIGH-1) — were both **new leaks introduced by a privacy fix**. When hardening a disclosure
channel, audit the *sibling* channels in the same breath: the error path, the HTML view, the logs, the
refusal prose. The success path is the one everybody looks at.
