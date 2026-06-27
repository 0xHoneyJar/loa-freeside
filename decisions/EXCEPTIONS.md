# Decision Exceptions Ledger

> The single canonical record of sanctioned, one-time bypasses of an otherwise-binding gate.
> Referenced by `.github/workflows/path-domain-check.yml` (ADR-007 §D-3). Every entry is a
> deliberate, logged exception — NOT a precedent. Reuse of any bypass requires a NEW entry (and,
> for ADR-bound rules, an ADR amendment). An empty cell in "Consumed" means the exception is
> still available for its single use; once used, mark it consumed with the PR/commit that used it.

| # | Date | Rule bypassed | Scope (single-use) | Why | Mirrors | Consumed |
|---|------|---------------|--------------------|-----|---------|----------|
| EXC-001 | 2026-06-26 | `main` branch protection — required status checks + required approving reviews (admin override, `enforce_admins: false`) | The **G1 / G-DOOR gate-fix PR** that introduces the `loa-signoff` + cheval-council door (`tools/loa-signoff.sh`, `tools/council-signoff.sh`, `grimoires/loa/context/g1-ghsignoff-door.md`). This PR is itself trapped behind the gate it opens (the new `loa-signoff` required check is not active until the protection flip in Step 1 of the design doc). It may be admin-merged **exactly once** to bootstrap the new gate. | ADR-007 §D-3 `adr-007-bootstrap` single-use bootstrap-bypass pattern | _(pending — record the merge SHA/PR here when used)_ |

## How to consume EXC-001 (the one sanctioned bootstrap admin-merge)

```bash
# SINGLE-USE. After this merge, the door is bootstrapped; flip branch protection (design-doc
# Step 1/2) so future PRs are gated by loa-signoff + the council review — NOT by admin override.
gh pr merge <THE_G1_DOOR_PR> --squash --admin --repo 0xHoneyJar/loa-freeside
```

Then return to `grimoires/loa/context/g1-ghsignoff-door.md` § "THE OPERATOR'S ONE STEP" and run
Steps 1–3 (require `loa-signoff`, set the approval bar, enable auto-merge). Any subsequent
admin-merge of a different PR is a NEW exception and needs its own row above.
