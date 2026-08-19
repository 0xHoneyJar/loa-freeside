# CR-000 — Discord restricted-tier viability evidence room

**Task:** Discord restricted-tier viability go/no-go
**Cycle:** `collection-report`
**Branch:** `coord/collection-report-coordinator-f09.10`
**Room type:** bounded DIG/ARCH evidence room
**Decision state:** `pending` (not Go, not No-go)

This directory is the CR-000 coordination workspace. It records public-policy
findings, repository non-secret evidence, private-evidence gaps, owner sign-off
blocks, and the machine-readable pending authority template.

It does **not** authorize restricted T2 work, alter production Discord
permissions, or invent an owner signature.

## Contents

| Path | Purpose |
|------|---------|
| [`decision-record.md`](./decision-record.md) | Current state, deadline, findings, gaps, T0/T1/T2 consequences, sign-offs |
| [`evidence-checklist.md`](./evidence-checklist.md) | Completable checklist for Discord application owner + privacy/security owner |
| [`pending-authority-record.yaml`](./pending-authority-record.yaml) | Versioned pending Discord-policy authority template |
| [`pending-authority-record.schema.json`](./pending-authority-record.schema.json) | JSON Schema for the authority record |
| [`repository-evidence.md`](./repository-evidence.md) | Non-secret origin/main audit notes (no portal inference) |
| [`link-validation.md`](./link-validation.md) | Primary-source link probe results |
| [`sources.md`](./sources.md) | Pointers to grounded public-policy packet and masters |

## Hard rules for this room

1. Unknown / missing private evidence remains `pending` until the ratified
   deadline. Pending does **not** become No-go early.
2. Restricted T2 stays **disabled** while the decision is `pending`.
3. T0 recognition and T1 public preparation remain intact regardless of CR-000.
4. Do not fabricate Go, No-go, owner identity, approval, privileged-intent
   portal state, user count, policy interpretation, or signatures.
5. Do not infer Developer Portal state from code or environment-variable names.
6. Do not change production bot permissions from this room.

## Related masters

- Coordinator PRD/SDD/sprint: `grimoires/loa/{prd,sdd,sprint}.md` (coordinator root)
- Task manifest: `grimoires/loa/coordination/task-manifest.yaml`
- Public-policy packet: `grimoires/loa/research/collection-report-cr000-source-packet.md`
