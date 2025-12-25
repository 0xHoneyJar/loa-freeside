# Legacy Documentation Inventory

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 3)

## Documentation Locations

### 1. Root `docs/` Directory
| File | Purpose | Status |
|------|---------|--------|
| `data/henlocker-bgt-guide.md` | BGT acquisition guide | Reference |
| `deployment/infrastructure.md` | Infrastructure docs | Current |
| `deployment/deployment-guide.md` | Deployment process | Current |
| `deployment/monitoring.md` | Monitoring setup | Current |
| `deployment/security.md` | Security documentation | Current |
| `deployment/disaster-recovery.md` | DR procedures | Current |
| `deployment/runbooks/deployment.md` | Deployment runbook | Current |
| `deployment/runbooks/rollback.md` | Rollback procedures | Current |
| `deployment/runbooks/incidents.md` | Incident response | Current |
| `deployment/runbooks/backups.md` | Backup procedures | Current |
| `deployment/runbooks/troubleshooting.md` | Troubleshooting guide | Current |
| `research/naming-universe-loa-research.md` | Loa naming research | Reference |

### 2. `sietch-service/docs/` Directory
| File | Purpose | Status |
|------|---------|--------|
| `discord-setup.md` | Discord bot setup | Current |
| `operations/server-admin.md` | Server admin guide | Current |
| `community/onboarding.md` | Member onboarding | Current |
| `handover/README.md` | Handover documentation | Current |
| `research/collabland-integration.md` | CollabLand research | Reference |
| `deployment/collabland-setup.md` | CollabLand setup | Current |
| `deployment/channel-access-setup.md` | Channel setup | Current |
| `deployment/PRE_DEPLOYMENT_CHECKLIST.md` | Pre-deployment | Current |
| `deployment/DEPLOYMENT_RUNBOOK.md` | Deployment runbook | Current |
| `deployment/infrastructure.md` | Infrastructure | Current |
| `deployment/deployment-guide.md` | Deployment guide | Current |
| `deployment/monitoring.md` | Monitoring | Current |
| `deployment/security.md` | Security | Current |
| `deployment/README.md` | Deployment index | Current |
| `deployment/HANDOVER.md` | Handover doc | Current |

### 3. `sietch-service/docs/a2a/` (Agent-to-Agent Feedback)
| Sprint | Files |
|--------|-------|
| Sprint 11 | reviewer.md, engineer-feedback.md, auditor-report.md |
| Sprint 12 | reviewer.md, engineer-feedback.md, auditor-sprint-feedback.md |
| Sprint 13 | reviewer.md, engineer-feedback.md, auditor-sprint-feedback.md |
| Index | index.md, deployment-feedback.md |

### 4. `loa-grimoire/context/` (Loa State Zone)
| File | Purpose | Status |
|------|---------|--------|
| `prd.md` | PRD v3.0 "The Great Expansion" | Current Context |
| `sdd.md` | SDD v3.0 "The Great Expansion" | Current Context |
| `sprint.md` | Sprint Plan v3.0 | Current Context |
| `prd-v2.1.md` | PRD v2.1 (deprecated) | LEGACY |
| `sdd-v2.1.md` | SDD v2.1 (deprecated) | LEGACY |
| `claims-to-verify.md` | Riding claims list | Generated |

### 5. `loa-grimoire/context/a2a/` (Historical Sprint Feedback)
| Sprint | Status |
|--------|--------|
| Sprint 1-10 | COMPLETED (reviewer, engineer, auditor) |
| Sprint 14 | COMPLETED |
| Sprint 15 | In Progress (reviewer.md only) |

### 6. `loa-grimoire/reality/` (Generated Reality Files)
| File | Generated |
|------|-----------|
| structure.md | 2025-12-24 |
| services.md | 2025-12-24 |
| database.md | 2025-12-24 |
| commands.md | 2025-12-24 |
| triggers.md | 2025-12-24 |
| api.md | 2025-12-24 |
| environment.md | 2025-12-24 |
| hygiene.md | 2025-12-24 |

## Documentation Categories

### Active (Keep Current)
- Deployment docs in both `docs/` and `sietch-service/docs/`
- Operations and community docs
- Current PRD/SDD v3.0 in `loa-grimoire/context/`
- Sprint feedback (a2a)

### Legacy (Mark Deprecated)
- `loa-grimoire/context/prd-v2.1.md` - Superseded by v3.0
- `loa-grimoire/context/sdd-v2.1.md` - Superseded by v3.0

### Generated (Regenerate on Ride)
- All files in `loa-grimoire/reality/`
- `loa-grimoire/context/claims-to-verify.md`

### Reference (Retain as-is)
- Research documents
- BGT guide
- CollabLand integration research

## Duplication Analysis

| Document Type | `docs/` | `sietch-service/docs/` | Notes |
|--------------|---------|------------------------|-------|
| infrastructure.md | YES | YES | Duplicate, consolidate |
| deployment-guide.md | YES | YES | Duplicate, consolidate |
| monitoring.md | YES | YES | Duplicate, consolidate |
| security.md | YES | YES | Duplicate, consolidate |
| runbooks/deployment.md | YES | YES | Duplicate, consolidate |
| runbooks/incidents.md | YES | YES | Duplicate, consolidate |
| runbooks/backups.md | YES | YES | Duplicate, consolidate |

**Recommendation**: Consolidate deployment docs to single location (prefer `sietch-service/docs/` for proximity to code)

## Sprint History

| Sprint | Version | Status | Location |
|--------|---------|--------|----------|
| 1-10 | v2.0 | COMPLETED | `loa-grimoire/context/a2a/` |
| 11-13 | v2.1 | COMPLETED | `sietch-service/docs/a2a/` |
| 14 | v2.1 | COMPLETED | `loa-grimoire/context/a2a/` |
| 15 | v3.0 | In Progress | `loa-grimoire/context/a2a/` |
