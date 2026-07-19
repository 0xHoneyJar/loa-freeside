# Corpus manifest — CR contract corpus (S1, manual mode)

run_mode: manual · taint: fixture-simulated (no attested host)
S0 ruled: 2026-07-19 by operator zksoju (scope: all 5 families · 4 exclusions
confirmed · org-private, no redactions · S13/P3 authority: zksoju · freeze below)

## Freeze

- Git anchor: `origin/main @ af06417992d15f982a1192236279f436b963c4e8` (2026-07-19)
- PR-trail snapshot taken 2026-07-19 via gh (this directory, immutable)
- Integrity: `checksums.sha256` (48 files) — re-verify with
  `cd corpus && shasum -a 256 -c checksums.sha256`

## Family 1 — merged PR trail (21 PRs, `prs/`)

`pr-<N>.json` (title/body/reviews/comments) + `pr-<N>-line-comments.json` per PR:
430 (collections-sot ancestry — supersedes #429), 473 (boundary acceptance),
475 (CR-001), 476 (CR-019 gates), 478 (Gate Leak ratification), 479 (durable
collection resolution), 480 (compat harness), 488 (CR-006), 489 (product +
catalog probe), 491 (CR-206), 492 (CR-305), 495 (preparing-path fix),
496 (CR-007A), 497 (CR-009), 498 (CR-013), 499 (CR-208), 500 (CR-012A),
501 (CR-201A), 502 (CR-201C), 503 (CR-202), 504 (CR-204A).
Excluded after title verification: #481 (agent-gateway, not CR);
#296/#387/#395/#429 (shadow-audit lane, ruled out).
Provenance: PR bodies/commits = author-attributed; review bodies incl.
Bridgebuilder = `model_output` — NEVER authority, per S0 sensitivity ruling.

## Family 2 — CR-coded ratified commits (21, `cr-commits.log`)

`git log origin/main --grep='CR-'` full messages at the freeze SHA.
(44 matched `--all`; the 23 non-main ones are unmerged coordinator commits,
excluded per S0 ruling #4.)

## Family 3 — rationale docs

- Snapshots in `briefs/` (source paths are gitignored/local-only):
  `2026-07-03-collections-sot-direction.md`,
  `2026-07-10-shadow-audit-collection-registry.grounded.md`,
  `2026-06-28-shadow-audit-belt-dag-subway-ordering.md`
- In-repo at freeze SHA (see blob anchors): `decisions/009-freeside-hexagonal-federation.md`
- PR #473 body (boundary acceptance) — in Family 1 snapshot.

## Family 4 — in-repo contract truth (blob-anchored, not copied)

`in-repo-blobs-at-freeze.txt`: 212 `git ls-tree -r` entries (blob SHAs) for the
six v1.0.0 protocol packages + collection-report-gates + ADR-009 at the freeze
SHA. Claims cite `path:line @ af064179`; blobs are content-addressed — no copy
needed, `git cat-file` reproduces any source exactly.

## Family 5 — fresh secondary (ai-autogen, checksummed upstream)

`grimoires/loa/ground-truth/{contracts,architecture}.md` @ repo b5df718a
(2026-07-19 ride; own checksums in `ground-truth/checksums.json`). Secondary
orientation only — never primary evidence for a claim.

## Exclusions (S0-ruled)

1. 0.x protocol lane (`shadow-audit`, `shadow-mode`, `eligibility`, `ordering`)
   + ordering runtime (consumer; cited lines admissible as evidence only)
2. `2026-07-13-member-legibility-collection-mirror.md` → précis candidate #2
3. `grimoires/loa/reality/*` (derived)
4. Unmerged coordinator-branch commits (unratified)
