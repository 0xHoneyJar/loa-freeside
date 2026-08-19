# Review Feedback — sprint-bug-419

**Verdict: CHANGES_REQUIRED → both blocking findings now ADDRESSED (see Resolution).**

> **Note on provenance**: this file could not be written during the `/review-sprint` turn — the harness
> strips `Write`/`Edit`/`NotebookEdit` while a review skill is active (loa#1195). The verdict was carried
> forward in-conversation and persisted here from the follow-up `/implement` turn.

---

## C-1 — `bin/demo.ts` crashed at import (BLOCKING) — **FIXED**

`packages/services/ordering/bin/demo.ts:34` builds `SAMPLE_OUTPUT` via `AuditOutputSchema.parse({...})`.
Its `aggregate` literal was not updated with the three new required fields.

**`parse()` takes `unknown`, so tsc was clean** — the failure was at *runtime, at import time*:

```
$ npx tsx -e "import('./bin/demo.ts')"
CRASH: [ "code": "invalid_type", "message": "Required" ]
```

The file's own comment — *"validated at construction so the demo can't drift from the contract"* — was
exactly the guarantee that broke. Demo-only, never a prod path, but a broken file shipped in the commit.

**Resolution**: added the three fields (`bin/demo.ts:45-50`), preserving the file's "healthy community"
story (92% coverage, confident). Grepped every other `*Schema.parse({` literal site: only two exist
(`audit-service.ts:237`, correct) — no other blind spots.

**Process lesson (worth keeping)**: the fast gate (tsc + vitest) is *structurally blind* to
`Schema.parse(<literal>)` drift, because the argument is typed `unknown`. Adding a required field to a
schema will not fail typecheck at those sites. Verify with an actual import, not tsc.

## C-2 — the schema documented a privacy invariant it did not enforce (BLOCKING, cross-model) — **FIXED**

Found by the cross-model dissenter (`codex-headless`), not by the human-side review.

`AuditAggregateSchema` stated the k-anon rule in prose but was a bare `z.object().strict()` with **no
cross-field refinement**, so the contract accepted both:

| Combination | Should be | Was |
|---|---|---|
| `unmatched: {bucketed '<5'}` + `role_coverage: 0.7` | rejected (back-computes the suppressed count) | **accepted** |
| `unmatched: {exact 8}` + `role_coverage: 1` | rejected (contradiction) | **accepted** |

The invariant lived **only in the producer** (`audit-service.ts`), so any *other* producer — a replay, a
cache, a hand-built fixture, a second service — could violate it silently, defeating the k-anon
suppression the BB-4 lesson already paid for. **A declared bound with no enforcement site is fiction.**

**Resolution**: `audit-output.ts:76-104` — a `.superRefine` enforcing
(1) `unmatched.kind === 'bucketed'` ⇒ `role_coverage === null` **or** `=== 1` (the zero-cohort exemption),
and (2) `unmatched.kind === 'exact' && value > 0` ⇒ `role_coverage !== 1`.

**Teeth verified**: 5 new tests in `audit-output.test.ts` (2 known-bad inputs that MUST fail to parse,
3 legal shapes). Mutation-tested — disabling the refinement makes both known-bad inputs parse and the
2 REJECT tests fail. The enforcement site is real, not decorative.

## Non-blocking — the zero-cohort exemption is a small existence-oracle — **DOCUMENTED**

Because a zero cohort publishes a ratio while a suppressed non-zero one does not, `role_coverage === null`
now *implies* `unmatched ∈ [1, k)` — narrowing the public `<k` bucket from `{0..k-1}` to `{1..k-1}`. It
discloses **existence** ("at least one member is unlinked"), never **identity**, so k-anonymity holds.
Now stated in the schema (`audit-output.ts:62-67`) rather than pretended away.

---

## Verification after fixes

| Check | Result |
|---|---|
| `@freeside/shadow-audit-protocol` | **53 pass** (48 + 5 new), tsc clean |
| `@freeside/shadow-audit-service` | **218 pass**, tsc clean |
| `bin/demo.ts` import | **no throw** (was: crash) |
| `@freeside/ordering-service` | 184 pass / **2 pre-existing** failures (`intake`, `projection` — `metadata_snapshot`; verified pre-existing on a clean HEAD worktree, unrelated) |
| `freeside-dashboard` mirror | 23 pass (PR #132) |

## What passed review unchanged (not re-litigated)

- **Root cause, not symptom**: coverage is a first-class input to confidence, and the signal reaches the
  *aggregate* — the only channel JSON consumers read. (`uncertain` alone was a no-op channel.)
- **Settle gate is real**: live 422 `role-coverage-too-low` on the real 515-entry export; before the fix
  the same input yielded `newly_eligible: 1813` with `uncertain: false`.
- **Public teaser unaffected** (verified live): `/v1/access-risk` still returns the real on-chain risk
  (1813 qualified@snapshot). The refusal *is* the sales conversation — the lead-magnet door stays open.
- **50% / 90% thresholds** and **refuse-vs-label**: settled operator decisions. Documented in `metrics.ts`;
  revisit against a second community's real coverage.

## Adversarial record

Cross-model: `codex-headless`, consensus, `chain_health=ok`, 1 BLOCKING finding (C-2, the one the
self-review missed) — `grimoires/loa/a2a/sprint-bug-419/adversarial-review.json`.
