# `@freeside/collection-report-gates`

CR-019 makes the collection-report release boundary executable. The package
contains:

- a versioned, exhaustive task/gate/tier/checkpoint/flag manifest;
- strict Effect schemas for the manifest boundary;
- deterministic semantic validation;
- a CLI suitable for CI and release tooling;
- positive and negative fixtures, including the Flatline T0/G2A omission and
  prohibited suffixed-task ranges.

The checked-in manifest is deliberately
`status: pending_owner_approval`. Every gate is `pending` and every feature flag
is disabled. This package does not approve a release.

## Validate

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check
```

Direct CLI use:

```bash
check-gate-manifest \
  --manifest manifest/collection-report.gates.yaml \
  --source test-vectors/source/task-manifest.yaml \
  --approval-keyring test-vectors/trust/approval-keyring.yaml \
  --acceptance-receipts test-vectors/positive/repository-acceptance-receipts.yaml \
  --acceptance-keyring test-vectors/trust/repository-acceptance-keyring.yaml
```

For an `owner_approved` manifest, also pass an independently governed trust
store with `--approval-keyring <trusted-gate-owners.yaml>`. Repository-owner
acceptance is a separate input and authority domain:
`--acceptance-receipts <repository-acceptance.yaml>` plus
`--acceptance-keyring <trusted-repository-owners.yaml>`. Neither receipt type
can satisfy the other, and the validator never accepts a public key asserted
by a receipt itself.

Exit codes are `0` for valid, `1` for validation findings, and `2` for
usage/I/O errors.

## Validity rules

- Static contract and schema fixtures use `valid_until: superseded`.
- Dynamic security, privacy, external-policy, load, and operational evidence
  declares `max_age_days` and a renewal owner.
- Pending dynamic evidence omits `valid_until`. Recording it must add an
  absolute `valid_until` no later than `recorded_at + max_age_days`.
- A gate cannot pass or resolve No-go with unrecorded or expired evidence.
- Evaluation uses the manifest's `evaluated_at` instant, not wall-clock time.

## Authority boundary

The prose sprint remains explanatory. After every gate owner approves this
manifest, `approvals` must contain one signed digest receipt per distinct gate
owner before a new version may set `status: owner_approved`. Each receipt binds
the owner, signing instant, and exact approval-scope manifest digest with a
verifiable Ed25519 signature whose owner-to-key binding comes from the
independently supplied keyring; individual gate states still advance only with
their required evidence.

Each required `ACCEPT-*` task must additionally have a valid repository-owner
receipt before its tier can become release-ready or a tier flag can be enabled.
That domain-separated Ed25519 receipt binds the acceptance task, repository,
repository-owner role, exact reviewed commit, immutable GitHub tree URI,
artifact digest, accepted/rejected state, and validity interval. File presence,
filenames, and prose are never interpreted as acceptance. Tier reports say
`structurally possible` separately from `release-ready`; a pending branch is
never described as ready merely because no No-go has closed it. Tier tables and
checkpoint diagrams remain summaries and cannot independently authorize
release.
