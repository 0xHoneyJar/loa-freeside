# CR-000 Evidence Checklist

Complete this checklist using Discord Developer Portal access, privacy/legal
review, and operational knowledge. Do **not** interpret the PRD/SDD/sprint to
fill gaps — those masters define *what* must be decided; this list defines the
evidence fields.

**Decision state while any Critical item is incomplete:** `pending`
**Restricted T2 while pending:** disabled
**Deadline:** `2026-07-30T23:59:59Z` (see `decision-record.md` §2)

Mark each item: `pending` | `complete` | `not_applicable` (N/A requires a
written reason). Attach evidence digests in
`pending-authority-record.yaml` when complete.

---

## A. Discord application identity (Critical — Application owner)

| ID | Evidence item | How to obtain | Status | Value / attachment ref |
|----|---------------|---------------|--------|------------------------|
| A1 | Discord Application ID | Developer Portal → Application → Application ID | pending | |
| A2 | Application / team owner name and contact | Developer Portal → Team / owner account | pending | |
| A3 | Bot user ID / bot username tag | Portal → Bot, or live bot profile | pending | |
| A4 | Which runtime(s) this application powers | Map portal app to deployed services (ingestor / Sietch / worker / other). Do not guess from env names alone. | pending | |
| A5 | Verification / App Review status | Portal verification and any App Review history | pending | |

---

## B. Privileged intents (Critical — Application owner)

| ID | Evidence item | How to obtain | Status | Value / attachment ref |
|----|---------------|---------------|--------|------------------------|
| B1 | Server Members Intent (`GUILD_MEMBERS`) toggle state in Portal | Portal → Bot → Privileged Gateway Intents | pending | |
| B2 | Whether Discord requires privileged-intent review for this app | Compare guild-installed user count to Discord’s published threshold; record Portal review state | pending | |
| B3 | If review required: approval status and date | Portal / Discord notice | pending | |
| B4 | If approved: exact approved use case text | Copy from submission / approval record | pending | |
| B5 | Approval conditions or restrictions | Approval correspondence | pending | |
| B6 | Message Content Intent portal state (if used by any production client) | Portal → Bot | pending | |
| B7 | Presence Intent portal state (if used by any production client) | Portal → Bot | pending | |
| B8 | Confirmation that production permissions will **not** be changed by this CR-000 process unless separately authorized | Owner attestation | pending | |

Note: Repository clients *request* `GuildMembers` in code. That is **not** an
answer for B1–B5.

---

## C. Scale / limits (Critical — Application owner)

| ID | Evidence item | How to obtain | Status | Value / attachment ref |
|----|---------------|---------------|--------|------------------------|
| C1 | Current guild-installed user count (Discord’s metric) | Developer Portal analytics / Discord-provided count | pending | |
| C2 | Band relative to 10,000 guild-installed users | Derived from C1: `under_10000` or `at_or_over_10000` | pending | |
| C3 | Largest target guild member count for Gate Leak V1 | Guild settings / ops export (no need to paste member PII here) | pending | |
| C4 | Known Discord pagination / rate-limit constraints accepted for capture design | Ops note acknowledging 1,000-member pages and privileged-intent dependency | pending | |

---

## D. Privacy policy and data use (Critical — Privacy/security owner)

| ID | Evidence item | How to obtain | Status | Value / attachment ref |
|----|---------------|---------------|--------|------------------------|
| D1 | Public privacy-policy URL that is current | Live URL that returns the policy document | pending | |
| D2 | Policy covers Discord API data collection | Policy text citation (section heading) | pending | |
| D3 | Policy covers joining Discord member/role data to wallet / identity links for audit | Policy text citation or explicit gap | pending | |
| D4 | Retention period for restricted Gate Leak evidence / identity rows | Policy or internal retention schedule aligned to CR-007B when available | pending | |
| D5 | Deletion / user opt-out / Discord-requested deletion process | Documented procedure owner + contact | pending | |
| D6 | Encryption at rest and access safeguards for API data | Security owner note (systems, not secrets) | pending | |
| D7 | Determination: proposed Gate Leak purpose is permitted under Discord Developer Terms/Policy as used by this application | Written determination | pending | |
| D8 | If conditions apply, list them | Written conditions | pending | |

---

## E. Purpose / data classes for authority record (Critical — both owners)

Fill the authority template fields; checklist tracks completeness only.

| ID | Evidence item | Status | Notes |
|----|---------------|--------|-------|
| E1 | Approved purposes list drafted (or explicit denial) | pending | e.g. Gate Leak V1 stale-access audit among mapped-role members |
| E2 | Approved data classes drafted (or explicit denial) | pending | e.g. guild id, role ids, discord user ids, linked wallets under consent, aggregate counts |
| E3 | Explicitly excluded purposes/data classes listed | pending | e.g. profiling, marketing, cross-community sharing |
| E4 | Effective time proposed | pending | |
| E5 | Expiry or earlier review date proposed (≤ 90 days from effective) | pending | |
| E6 | Renewal owner named (Discord application owner role) | pending | |
| E7 | Emergency revocation contacts named | pending | |

---

## F. Shadow Audit / capture boundary readiness (Supporting — not a substitute for A–E)

| ID | Evidence item | Status | Notes |
|----|---------------|--------|-------|
| F1 | Confirm current production Shadow Audit path for roles (file export vs live Gateway) | pending | Repo today: file-backed `ROLE_SNAPSHOT_PATH` |
| F2 | Confirm no restricted T2 producer is enabled while CR-000 is pending | pending | Expect disabled |
| F3 | Confirm dogfood/k-anonymity controls remain for any non-T2 audit paths | pending | `AUDIT_K` etc. are not CR-000 Go |

---

## G. Sign-off (Critical)

| ID | Evidence item | Status |
|----|---------------|--------|
| G1 | Discord application owner completed §10.1 in `decision-record.md` | pending |
| G2 | Privacy/security owner completed §10.2 in `decision-record.md` | pending |
| G3 | Both decisions agree (both Go, or either/both No-go) | pending |
| G4 | `pending-authority-record.yaml` updated to match signed outcome | pending |
| G5 | If Go: authority version recorded for restricted work-key projection | pending |
| G6 | If No-go or deadline auto-No-go: T2 remains disabled; T0/T1 confirmed intact | pending |

---

## Completion rule

- **Go:** all Critical rows in A–E and G are `complete`, both owners signed Go,
  authority record is non-pending with digests filled.
- **No-go:** either owner signed No-go, **or** deadline `2026-07-30T23:59:59Z`
  passed with Critical items still `pending`.
- **Until then:** leave decision state `pending`; do not enable T2.
