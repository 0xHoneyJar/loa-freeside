# Developer Guide

<!-- cite: loa-freeside:README.md -->
<!-- cite: loa-freeside:docs/ECOSYSTEM.md -->
<!-- cite: loa-freeside:docs/API-QUICKSTART.md -->
<!-- cite: loa-freeside:docs/API-REFERENCE.md -->
<!-- cite: loa-freeside:docs/INFRASTRUCTURE.md -->
<!-- cite: loa-freeside:docs/CLI.md -->

> Version: v1.0.0

This guide provides a learning path through the loa-freeside documentation and establishes ownership, versioning, and maintenance practices.

## Learning Path

Read the documentation in this order. Each document builds on the previous:

| # | Document | What You'll Learn |
|---|----------|-------------------|
| 1 | [README.md](../README.md) | What Freeside is, quick start, project structure |
| 2 | [ECOSYSTEM.md](ECOSYSTEM.md) | How Freeside fits into the 5-repo Loa protocol |
| 3 | [API-QUICKSTART.md](API-QUICKSTART.md) | Make your first agent invocation in 5 minutes |
| 4 | [API-REFERENCE.md](API-REFERENCE.md) | Full API reference (Tier 1 stable + Tier 2 index) |
| 5 | [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Deployment topology, Terraform modules, monitoring |
| 6 | [CLI.md](CLI.md) | gaib CLI for sandbox and server management |

### By Role

| Role | Start With | Focus On |
|------|-----------|----------|
| **New contributor** | README → ECOSYSTEM → API-QUICKSTART | Understand the system, make a call |
| **API consumer** | API-QUICKSTART → API-REFERENCE | Build integrations against stable endpoints |
| **Operator** | INFRASTRUCTURE → CLI | Deploy, manage, monitor |
| **Core developer** | All, in order | Full context |

## Document Ownership

Every document has a Directly Responsible Individual (DRI), an update trigger, and a review cadence.

| Document | DRI | Update Trigger | Review Cadence |
|----------|-----|----------------|----------------|
| README.md | Core team | Major feature or architecture change | Every release cycle |
| ECOSYSTEM.md | Core team | New repo added or protocol change | Quarterly |
| API-QUICKSTART.md | API lead | Tier 1 endpoint change | Every release cycle |
| API-REFERENCE.md | API lead | Any route addition, removal, or schema change | Every release cycle |
| API-CHANGELOG.md | API lead | Tier 1 breaking change or deprecation | On change |
| INFRASTRUCTURE.md | Platform lead | Terraform module added or topology change | Quarterly |
| CLI.md | CLI maintainer | gaib command added or changed | Every release cycle |
| DEVELOPER-GUIDE.md | Core team | New document added | Annually |
| BUTTERFREEZONE.md | Automated | butterfreezone-gen.sh output | Every release cycle |

## Versioning

Each document carries a version header (`v<major>.<minor>.<patch>`):

- **Major**: Document restructured or sections removed
- **Minor**: New section added or significant content update
- **Patch**: Typo fixes, link updates, clarifications

The BUTTERFREEZONE.md version is managed by `butterfreezone-gen.sh` and should not be edited manually.

## Errata Process

If you find an error in any document:

1. **Minor errors** (typos, broken links): Fix directly in a PR
2. **Factual errors** (wrong endpoint, incorrect config): Open an issue tagged `docs-errata`
3. **Missing content**: Open an issue tagged `docs-gap` with the section and expected content
4. **Stale content**: Run `scripts/rtfm-validate.sh` to detect drift, then fix

All errata PRs should include a version bump in the document header.

## Validation

Run the documentation validation suite before submitting doc changes:

```bash
# Full validation (8 checks)
scripts/rtfm-validate.sh

# Quick checks
scripts/extract-routes.sh --diff        # Route drift detection
scripts/verify-routes.sh --dry-run      # Route contract structure
scripts/pin-citations.sh --validate-only # Citation format validation
```

## Next Steps

- [README.md](../README.md) — Start here if you haven't already
- [ECOSYSTEM.md](ECOSYSTEM.md) — Understand the protocol stack
- [API-QUICKSTART.md](API-QUICKSTART.md) — Make your first API call
