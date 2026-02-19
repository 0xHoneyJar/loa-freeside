# SDD: The Neuromancer Codex — Documentation as Product Surface

**Version:** 1.0.0
**Date:** 2026-02-19
**Status:** Active
**Cycle:** cycle-035
**PRD:** grimoires/loa/prd.md (v1.1.0)

---

## 1. Executive Summary

This SDD designs the documentation architecture for transforming loa-freeside's external surface from "Discord bot" to "multi-model agent economy infrastructure platform." The work spans 10 documents across 5 categories: identity (README, BUTTERFREEZONE), ecosystem (ECOSYSTEM.md), developer surface (API quick-start, API reference, CLI docs), infrastructure (IaC docs), and meta (developer guide, ownership).

**Key design decisions:**
- **Document-from-code** — every doc is generated from or validated against source files, never written from memory
- **Stable subset API docs** — 7 guaranteed-stable endpoints fully documented; 70+ remaining auto-extracted as route index
- **JSON canonicalization for BUTTERFREEZONE** — hash structured JSON extraction, not raw Markdown
- **Citation automation** — `pin-citations.sh` resolves cross-repo references to commit SHA permalinks
- **Naming grep gate** — zero-tolerance files validated by regex denylist in CI
- **Ownership-first sustainability** — every document has a DRI, update trigger, and review cadence

---

## 2. Document Architecture

### 2.1 Information Hierarchy

```
README.md                          ← Entry point: "What is this?"
├── docs/ECOSYSTEM.md              ← "How does the ecosystem fit together?"
├── docs/API-QUICKSTART.md         ← "Make your first API call"
│   └── docs/API-REFERENCE.md      ← "Full endpoint reference"
├── docs/INFRASTRUCTURE.md         ← "Deploy your own instance"
├── docs/CLI.md                    ← "CLI command reference"
└── docs/DEVELOPER-GUIDE.md        ← "Onboarding index + ownership table"

BUTTERFREEZONE.md                  ← Agent context (parallel entry point for AI)
```

### 2.2 Document Inventory

| Document | Type | Source of Truth | Generation Method |
|----------|------|----------------|-------------------|
| README.md | Identity | Codebase reality files + package.json | Hand-written, validated against reality/ |
| BUTTERFREEZONE.md | Agent context | Codebase scan | Script-generated (`butterfreezone-gen.sh`) |
| docs/ECOSYSTEM.md | Ecosystem | 5 repo READMEs + package.json deps | Hand-written, stats from `ecosystem-stats.sh` |
| docs/API-QUICKSTART.md | Developer | Route source files | Hand-written, validated by smoke-test |
| docs/API-REFERENCE.md | Developer | Route source files | Stable subset hand-written + auto-extracted index |
| docs/INFRASTRUCTURE.md | Infrastructure | Terraform .tf files | Hand-written, validated by `terraform plan` |
| docs/CLI.md | Developer | CLI source files | Hand-written, validated against `gaib --help` |
| docs/DEVELOPER-GUIDE.md | Meta | All docs | Hand-written index + ownership table |

### 2.3 Cross-Reference Map

Each document ends with a "Next Steps" section linking to the logical next document:

```
README → ECOSYSTEM → API-QUICKSTART → API-REFERENCE
                  → INFRASTRUCTURE
                  → CLI
                  → DEVELOPER-GUIDE (index)
```

---

## 3. Component Design

### 3.1 README.md

**Structure:**

```markdown
# loa-freeside

[badges: version, license, tests]

[1-2 sentence description: what this IS]

## What is Freeside?

[3-4 paragraphs: platform description grounded in capabilities]
[Each capability cites source file]

## The Ecosystem

[Layer diagram: 5 repos]
[Brief description of each repo]
[Link to docs/ECOSYSTEM.md]

## Architecture

[ASCII diagram: packages, apps, infrastructure, themes]

## Quick Start

### For Developers (API)
[Link to docs/API-QUICKSTART.md]

### For Community Operators (Discord/Telegram)
[Link to INSTALLATION.md]

## Technology Stack

[Table: layer → technology]

## Documentation

[Table: document → audience → description]

## The Neuromancer Connection

[Brief naming explanation]
[Link to docs/ECOSYSTEM.md for full map]
```

**Source grounding pattern — unified citation syntax:**

All documentation uses a single machine-readable citation format for both local and cross-repo references:

```markdown
**Multi-model inference** — 5-pool routing with ensemble orchestration.
<!-- cite: loa-freeside:packages/adapters/agent/pool-mapping.ts#L15-L45 -->
<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts -->

Protocol contract flow follows Level 4 state machines.
<!-- cite: loa-hounfour@v7.0.0:src/state-machines.ts -->
```

**Citation syntax**: `<!-- cite: <repo>[@<ref>]:<path>[#L<start>[-L<end>]] -->`

| Component | Required | Description |
|-----------|----------|-------------|
| `repo` | Yes | Repository name (e.g., `loa-freeside`, `loa-hounfour`) |
| `@ref` | No (local repo) / Yes (cross-repo) | Tag, commit SHA, or version |
| `path` | Yes | File path relative to repo root |
| `#Lstart-Lend` | No | Line range for precision |

HTML comments — visible in raw Markdown, invisible in rendered GitHub view. This keeps docs clean while maintaining traceability. Both `pin-citations.sh` and RTFM validation parse this exact syntax.

**`pin-citations.sh` behavior:**

Scans all docs for `<!-- cite: ... -->`, resolves cross-repo references (`@v7.0.0` → commit SHA permalink), rewrites to `<!-- cite: ... -->` with resolved URL appended, reports any unresolvable references as errors.

**Resilience features:**

| Feature | Implementation |
|---------|---------------|
| **Retry/backoff** | 3 retries with exponential backoff (1s, 2s, 4s) for GitHub API failures |
| **Rate limiting** | Respects `X-RateLimit-Remaining` header; waits when <10 remaining |
| **Authentication** | Uses `GITHUB_TOKEN` or `gh auth token` for authenticated API access (higher rate limits) |
| **Offline validation** | `--validate-only` flag checks already-pinned permalinks exist in local git cache without network calls |
| **Caching** | Resolved SHA mappings cached to `grimoires/loa/cache/citation-pins.json`; reused when tag→SHA mapping unchanged |
| **Immutable refs** | Cross-repo citations must use commit SHA in the resolved permalink (not tag), ensuring immutability even if tags are moved |

**Modes:**
- `pin-citations.sh --pin` — resolve and rewrite (requires network)
- `pin-citations.sh --validate-only` — check existing pins are well-formed (offline)
- `pin-citations.sh --check-stale` — report citations where the pinned SHA is >30 days old

### 3.2 BUTTERFREEZONE.md

**Canonicalization architecture:**

```
Codebase Scan
     │
     ▼
┌─────────────┐
│ Extract per  │   butterfreezone-gen.sh scans:
│ section to   │   - package.json (name, version, deps)
│ structured   │   - packages/core/ports/ (interfaces)
│ JSON objects │   - themes/sietch/src/api/routes/ (HTTP routes)
│              │   - themes/sietch/src/discord/commands/ (Discord)
│              │   - themes/sietch/src/telegram/commands/ (Telegram)
│              │   - packages/cli/src/commands/ (CLI)
│              │   - infrastructure/terraform/ (IaC modules)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Canonicalize │   jq canonicalization (project-normative algorithm):
│ JSON → hash  │   1. `jq -Sc '.'` — sort object keys, compact output
│              │   2. jq handles: key sorting, compact whitespace,
│              │      deterministic number formatting, valid JSON output
│              │   3. Strings: no mutation — emit as extracted
│              │   4. Arrays: preserve extraction order (extractor emits
│              │      deterministic order by construction — routes sorted
│              │      by {method, path}, commands sorted by name, etc.)
│              │   5. UTF-8 encoding, LF line ending (no trailing newline)
│              │   6. SHA-256 hash of the canonical byte string
│              │   7. Pinned jq version: >=1.7 (for stable sort behavior)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Render       │   Template produces Markdown with:
│ Markdown     │   - AGENT-CONTEXT header (name, type, purpose, key_files)
│ + meta block │   - Capabilities with source citations
│              │   - Interfaces (routes, commands)
│              │   - Module map with line counts
│              │   - ground-truth-meta footer with section hashes
└─────────────┘
```

**Key canonicalization rules:**
- **No semantic mutations**: strings are never trimmed, truncated, or normalized beyond UTF-8 encoding. The extractor is responsible for emitting clean values; the canonicalizer preserves them exactly.
- **Object keys only sorted**: array order is determined at extraction time. The extractor sorts arrays by a declared key (e.g., routes by `{method, path, source}`, commands by `{name}`) before emitting JSON. The canonicalizer does NOT re-sort arrays.
- **Single implementation**: both `butterfreezone-gen.sh` and `butterfreezone-validate.sh` use the same `jq -Sc '.'` canonicalization filter to ensure identical output. This is the ONLY code path that produces canonical JSON.
- **Not RFC 8785 JCS**: this project uses `jq` canonicalization as its normative algorithm, not RFC 8785. The two differ in number formatting edge cases. Since both gen and validate use the same `jq` binary (version >=1.7 pinned), hashes are stable within the project. Cross-tool interoperability with JCS implementations is not a goal.
- **jq version pinning**: CI and scripts must use jq >=1.7. The version is checked at script startup: `jq --version | grep -qE '^jq-1\.[7-9]' || exit 1`.

**Error taxonomy and fail-closed behavior:**

Both `butterfreezone-gen.sh` and `butterfreezone-validate.sh` must handle errors deterministically:

| Error Class | Exit Code | Behavior |
|------------|-----------|----------|
| Parse error (malformed TS/JSON) | 10 | Fail closed — do NOT emit partial output |
| Missing required file (package.json) | 11 | Fail closed — require minimum file set |
| Partial scan (some sections extracted, others failed) | 12 | Fail closed — all-or-nothing extraction |
| jq version mismatch | 13 | Fail immediately at startup |
| Hash mismatch (validate only) | 20 | Report diffs per section, exit non-zero |

**Minimum required sections:** The generator must emit at least `agent_context`, `capabilities`, `interfaces`, and `module_map`. If any section produces zero entries, it is an error (exit 12), not a valid empty section.

**Cross-platform extraction determinism:**

To ensure identical output across Linux/macOS/CI:
- **File discovery:** All file lists are sorted lexicographically (`LC_ALL=C sort`) after glob expansion. Never rely on filesystem traversal order.
- **Line endings:** Normalize to LF at extraction time (`tr -d '\r'`).
- **Node/ts-morph pinning:** Pin ts-morph version in package.json; CI uses same Node major version as dev.
- **Golden tests include platform tags:** Cross-platform vectors run on both Linux and macOS CI to catch divergence.

**Agent context fields (updated):**

```yaml
name: loa-freeside
type: platform
purpose: Multi-model agent economy infrastructure — inference routing, budget atomicity, token-gated capability markets, and payment rails for Web3 communities
key_files:
  - packages/core/ports/agent-gateway.ts
  - packages/adapters/agent/pool-mapping.ts
  - packages/adapters/agent/ensemble-accounting.ts
  - packages/adapters/agent/budget-manager.ts
  - themes/sietch/src/api/routes/agents.routes.ts
  - themes/sietch/src/api/routes/billing-routes.ts
  - packages/cli/src/index.ts
  - infrastructure/terraform/main.tf
version: (from package.json)
trust_level: grounded
```

**Golden test vectors:**

Location: `tests/fixtures/butterfreezone-golden/`

Each vector is a **minimal fixture tree** that mimics real repo structure:

```
tests/fixtures/butterfreezone-golden/
├── vector-001-routes/
│   ├── fixture/                     # Minimal repo structure
│   │   ├── package.json             # Name, version, deps
│   │   └── themes/sietch/src/api/routes/
│   │       └── agents.routes.ts     # Known route registrations
│   ├── expected-interfaces.json     # Expected canonical JSON from extractor
│   └── expected-interfaces.hash     # SHA-256 of the canonical JSON
├── vector-002-commands/
│   ├── fixture/
│   │   └── themes/sietch/src/discord/commands/
│   │       └── ping.ts              # Known command definition
│   ├── expected-interfaces.json
│   └── expected-interfaces.hash
└── vector-003-full/
    ├── fixture/                     # Full minimal tree (all sections)
    ├── expected-agent-context.json
    ├── expected-capabilities.json
    ├── expected-interfaces.json
    └── expected-*.hash
```

The extractor runs against the `fixture/` directory (not Markdown). This tests the same code path used in production: scan repo structure → extract JSON → canonicalize → hash.

Validation: `butterfreezone-validate.sh` re-runs extraction on the current codebase and compares section hashes against the `ground-truth-meta` block in the generated BUTTERFREEZONE.md. Golden vectors separately test the extraction logic against known fixture inputs to catch regressions in the extractor itself.

### 3.3 docs/ECOSYSTEM.md

**Structure:**

```markdown
# The Loa Ecosystem

## The Stack

[Layer diagram with all 5 repos]

## Repositories

### loa-freeside (Freeside)
[Purpose, stats, key interfaces, links]

### loa-finn (The Finn)
[Purpose, stats, key interfaces, links]

### loa-hounfour (The Hounfour)
[Purpose, stats, key interfaces, links]

### loa-dixie (Dixie Flatline)
[Purpose, stats, links]

### loa (The Framework)
[Purpose, links]

## The Neuromancer Map
[Full naming explanation with Gibson references]

## Protocol Contract Flow
[How loa-hounfour schemas flow through the system]

## The Web4 Connection
[Brief link to wider vision — not marketing, context]

## Statistics
[Table with measurement method, commit SHAs, generated_at]
```

**Stats generation:**

`scripts/ecosystem-stats.sh` computes verifiable statistics for all 5 repos:

**Local repo (loa-freeside):**
1. Runs `cloc --json --exclude-dir=node_modules,.next,dist,build` for line counts
2. Runs `pnpm test -- --reporter=json 2>/dev/null | jq '.numTotalTests'` for test count
3. Records `git rev-parse HEAD` as commit SHA

**Remote repos (loa-finn, loa-hounfour, loa-dixie, loa):**
1. Shallow-clone at pinned ref: `git clone --depth 1 --branch <tag> <repo_url> /tmp/eco-stats/<repo>`
2. Run same `cloc` and test discovery in the clone
3. Record the tag/SHA used
4. Clean up clone after extraction

```bash
# Example output per repo:
{
  "repo": "loa-hounfour",
  "ref": "v7.0.0",
  "commit_sha": "abc123...",
  "lines": { "typescript": 12450, "total": 15200 },
  "tests": 1097,
  "measured_at": "2026-02-19T20:00:00Z"
}
```

**Caching:** Results are cached to `grimoires/loa/cache/ecosystem-stats.json` with TTL of 7 days. The script skips cloning for repos whose pinned ref hasn't changed since last run. Force refresh via `--fresh` flag.

Stats are embedded in the doc with `generated_at` timestamp and the ref used for measurement.

### 3.4 docs/API-QUICKSTART.md

**Stable subset (7 endpoints):**

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 1 | GET | `/api/agents/health` | None | Health check (entry point) |
| 2 | GET | `/.well-known/jwks.json` | None | JWKS for JWT verification |
| 3 | POST | `/api/agents/invoke` | JWT | Synchronous agent invocation |
| 4 | POST | `/api/agents/stream` | JWT | SSE streaming invocation |
| 5 | GET | `/api/agents/budget` | JWT | Budget status |
| 6 | GET | `/api/agents/models` | JWT | Available models for tier |
| 7 | GET | `/api/billing/balance` | JWT | Credit balance |

Each endpoint documented with:
- `curl` command (copy-pastable against localhost:3000)
- Request headers
- Request body (JSON with realistic payload)
- Response body (actual shape from route handler)
- Error cases

**Stability contract for "Guaranteed Stable" endpoints:**

The 7 stable endpoints carry an explicit contract:

| Property | Guarantee |
|----------|-----------|
| **Compatibility** | Response shape will not have fields removed or type-changed without a major version bump |
| **Deprecation** | Minimum 2 cycle (4-week) deprecation window with `Sunset` header before removal |
| **Versioning** | No path versioning currently; breaking changes require new path (e.g., `/api/v2/agents/invoke`) |
| **Change log** | All changes to stable endpoints documented in `docs/API-CHANGELOG.md` with date and migration guide |
| **Promotion** | Tier 2 → Tier 1 requires: stable for 2+ cycles, smoke-test coverage, full request/response docs |

**Tier 2 (indexed) endpoint contract:**

Tier 2 routes are labeled `Internal` or `Unstable` and carry weaker guarantees:

| Property | Guarantee |
|----------|-----------|
| **Compatibility** | May change without notice between cycles |
| **Documentation** | Method, path, auth requirement only — no request/response examples |
| **Monitoring** | Minimal automated contract checks: auth requirement correctness and 2xx/4xx status code validation |
| **Warning** | `X-Stability: unstable` header recommended for unstable endpoints |

**Automated contract checks for Tier 2:**

A lightweight integration test suite runs the extracted route index against a local dev server:
1. For each indexed route, verify the expected auth requirement (unauthenticated → 401/403 if auth required, 2xx if no auth)
2. For each indexed route, verify it responds (not 404)
3. Results compared against `scripts/route-snapshot.json` — divergence is a CI warning (not blocking for docs, but logged)

**Smoke-test checklist:** A numbered set of curl commands at the end of the doc. Running them against a local instance validates the docs are accurate.

**Local auth setup (prerequisite for smoke tests):**

The quick-start must include a self-contained "Get a JWT" section before any authenticated curl examples:

```bash
# 1. Generate dev keypair (one-time)
gaib auth setup-dev
# Creates .dev-keys/private.pem and .dev-keys/public.pem
# Configures local server to trust this keypair via JWKS

# 2. Mint a dev JWT (valid 1 hour)
export JWT=$(gaib auth token --dev)
# Token claims: { iss: "dev-local", aud: "loa-freeside", sub: "dev-user", exp: +3600 }

# Alternative: manual JWT signing (if gaib not installed)
# See docs/API-QUICKSTART.md § "Manual JWT" for openssl-based approach
```

The smoke-test script sources `$JWT` from this flow.

**AUTH_BYPASS code-level safeguard (required):**

If the platform supports `AUTH_BYPASS=true` for local dev, the following code-level protections are **required** (not just documented):

| Protection | Implementation |
|-----------|---------------|
| Environment gate | `AUTH_BYPASS` only honored when `NODE_ENV !== 'production'` |
| Startup check | Server refuses to start if `AUTH_BYPASS=true` and `NODE_ENV=production` |
| Log warning | Emits `WARN: AUTH_BYPASS is enabled — development only` at startup |
| Build exclusion | Production Docker builds set `NODE_ENV=production` and do not include bypass code path |

The quick-start documents AUTH_BYPASS with: `⚠️ Development only. Disabled by default. Code-enforced: will not activate in production builds.`

**Security disclaimers section:**
- "Local Development Only" banner at top
- Key rotation expectations
- Token TTL guidance
- Never embed private keys in code
- Separate dev/prod JWKS
- Audience and issuer validation

### 3.5 docs/API-REFERENCE.md

**Two-tier structure:**

**Tier 1: Stable endpoints** (from quick-start, full documentation)

**Tier 2: Route index** (auto-extracted, minimal documentation)

Auto-extraction approach:

`scripts/extract-routes.sh` uses `ts-morph` (TypeScript compiler API) to parse route files via AST rather than regex/grep.

**Supported route registration patterns:**

The extractor recognizes these Express patterns:

| Pattern | Example | Supported |
|---------|---------|-----------|
| Direct method call | `router.get('/path', handler)` | Yes |
| `router.use()` sub-mount | `router.use('/api', subRouter)` | Yes (resolves base path) |
| Method chaining | `router.route('/path').get(h1).post(h2)` | Yes |
| Path constants | `const PATH = '/api/foo'; router.get(PATH, h)` | Yes (resolves string literals) |
| Middleware chain | `router.get('/path', auth, validate, handler)` | Yes (detects auth middleware) |
| Template literals | `` router.get(`/api/${version}/foo`, h) `` | **No** — flagged as unresolvable |
| Dynamic/computed | `router[method](path, handler)` | **No** — flagged as unresolvable |
| Conditional registration | `if (env) router.get(...)` | **No** — flagged as unresolvable |

**Unresolvable route linter:** When the extractor encounters a route registration it cannot statically resolve, it emits a warning with file:line. A linter gate counts unresolvable registrations — if >5% of registrations are unresolvable, extraction fails. This prevents silent omissions.

```bash
# extract-routes.sh internals:
# 1. Load TypeScript project via ts-morph
# 2. Find all Router method calls (.get, .post, .put, .patch, .delete, .use)
# 3. Resolve mounted base paths from .use() calls
# 4. Extract auth middleware presence from handler chain
# 5. Flag unresolvable patterns with warning
# 6. Emit JSON: { method, full_path, auth, source_file, line }
# 7. Sort by {method, full_path} for deterministic output
```

**Dual extraction strategy (primary + verification):**

| Strategy | Method | Purpose |
|----------|--------|---------|
| Primary | ts-morph AST parsing (static) | Produces route index for docs |
| Verification | Runtime route-table introspection | Cross-checks AST extraction |

The verification strategy starts a local dev server, queries the Express route stack via `app._router.stack`, and compares the `{method, path}` set against the AST extraction output. Discrepancies are reported as errors.

**Completeness gate:** Instead of a simple count baseline, the gate uses a **snapshot diff** of the `{method, path}` set:

```bash
# Route snapshot stored at scripts/route-snapshot.json
# On extraction, diff against snapshot:
# - New routes: informational (update snapshot)
# - Missing routes: ERROR (extraction regression or route removed)
# - Changed auth: WARNING (review required)
scripts/extract-routes.sh --diff scripts/route-snapshot.json
```

This produces a table like:

| Method | Path | Auth | Source | Stability |
|--------|------|------|--------|-----------|
| POST | `/api/agents/invoke` | JWT | agents.routes.ts:193 | **Stable** |
| GET | `/api/admin/byok/keys` | Admin | byok.routes.ts:147 | Internal |
| ... | ... | ... | ... | ... |

Routes marked `Internal` or `Unstable` have no request/response examples — just the index entry.

### 3.6 docs/INFRASTRUCTURE.md

**Structure:**

```markdown
# Infrastructure

## Deployment Architecture

[ASCII diagram: ECS → RDS → ElastiCache → ALB → Route53]

## Terraform Modules

| Module | File | Purpose | Key Variables |
|--------|------|---------|---------------|
| Compute | ecs.tf | ECS Fargate | instance count, CPU, memory |
| Database | rds.tf | PostgreSQL | instance class, storage |
| ... | ... | ... | ... |

## Staging Deployment Guide

### Prerequisites
### Step-by-Step
### Post-Deployment Verification

## Monitoring & Observability

### CloudWatch Dashboards
### Alarms
### Log Aggregation

## Cost Estimation

[Table grounded in actual Terraform resource configs]

## Production Hardening Checklist

[Checklist format — items beyond staging scope]
```

### 3.7 docs/CLI.md

Source: `packages/cli/src/commands/` — extract from Commander.js definitions.

### 3.8 docs/DEVELOPER-GUIDE.md

Index page + ownership table from FR-9.

---

## 4. Tooling Pipeline

### 4.1 Generation Tools

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `butterfreezone-gen.sh` | Generate BUTTERFREEZONE.md | Codebase scan | BUTTERFREEZONE.md |
| `scripts/ecosystem-stats.sh` | Generate ecosystem statistics | `cloc` + `gh api` | JSON stats blob |
| `scripts/extract-routes.sh` | Extract route index from Express | Route source files | Markdown table |
| `scripts/pin-citations.sh` | Pin cross-repo references | Docs with `repo@version:path` | Docs with permalink URLs |

### 4.2 Validation Tools

| Tool | Purpose | Gate |
|------|---------|------|
| `butterfreezone-validate.sh` | Verify BUTTERFREEZONE hashes | BUTTERFREEZONE acceptance |
| Smoke-test checklist (curl commands) | Verify API docs against running instance | API docs acceptance |
| `terraform plan` | Verify IaC docs match actual config | IaC docs acceptance |
| `gaib --help` comparison | Verify CLI docs match implementation | CLI docs acceptance |
| Naming grep check | Zero "Arrakis" in zero-tolerance files | Naming acceptance |
| Cross-repo citation check | No branch-relative links | Citation acceptance |

### 4.3 Naming Migration

**Approach:** Search-and-replace in documentation files only. Code-level naming changes are out of scope.

**Zero-tolerance validation:**
```bash
# Must return 0 matches for each file
for f in README.md BUTTERFREEZONE.md docs/ECOSYSTEM.md docs/API-QUICKSTART.md \
         docs/API-REFERENCE.md docs/INFRASTRUCTURE.md docs/DEVELOPER-GUIDE.md; do
  count=$(grep -ci "arrakis" "$f" 2>/dev/null || echo 0)
  if [ "$count" -gt 0 ]; then
    echo "FAIL: $f has $count Arrakis references"
  fi
done
```

**Historical reference pattern** (allowed in CHANGELOG.md, INSTALLATION.md):
```markdown
> *Formerly known as Arrakis. Rebranded to loa-freeside (Cycle 035).*
```

---

## 5. Data Architecture

Not applicable — this is a documentation cycle with no database changes.

---

## 6. API Design

Not applicable — no new API endpoints. API documentation references existing endpoints.

---

## 7. Security Considerations

### 7.1 Quick-Start Security

The API quick-start teaches JWT authentication patterns. Security risks:

| Risk | Mitigation in Docs |
|------|-------------------|
| Private key leakage | Explicit warning: "Never commit private keys" |
| Dev JWKS in production | Warning: "Generate separate JWKS for production" |
| Long-lived tokens | Document recommended TTL (15 min for access tokens) |
| Missing audience validation | Include `aud` and `iss` in example JWT payload |
| Admin endpoint exposure | Admin docs high-level only, separate from quick-start |

### 7.2 IaC Documentation Security

Terraform docs reference AWS resources. Risks:

| Risk | Mitigation |
|------|-----------|
| Credential exposure | Never include actual AWS credentials in docs; use placeholder variables |
| Security group misconfiguration | Document recommended ingress/egress rules explicitly |
| Unencrypted storage | Document KMS encryption as required, not optional |

---

## 8. Execution Architecture

### 8.1 Phase Sequencing (from PRD FR-10)

```
Phase A (Days 1-2): IDENTITY
├── README.md rewrite
├── BUTTERFREEZONE.md regeneration
└── docs/ECOSYSTEM.md creation
     Gate: P0 docs review-ready

Phase B (Days 3-5): DEVELOPER SURFACE    Phase C (Days 6-7): INFRASTRUCTURE
├── docs/API-QUICKSTART.md               ├── docs/INFRASTRUCTURE.md
├── docs/API-REFERENCE.md                └── terraform plan verification
├── docs/CLI.md update                        Gate: terraform plan clean
├── Security disclaimers
└── Smoke-test validation
     Gate: smoke-test passes

Phase D (Days 8-9): POLISH
├── docs/DEVELOPER-GUIDE.md (index + ownership)
├── Cross-links between all documents
├── Route index auto-extraction
├── Citation pinning (pin-citations.sh)
└── Gate: RTFM validation passes

Phase E (Day 10): VALIDATION
├── RTFM full audit
├── Naming grep check
├── BUTTERFREEZONE hash validation
├── Ownership table committed
└── Gate: all success criteria met
```

### 8.2 Parallel Execution Opportunities

Phases B and C are independent and can run in parallel. Within each phase:

| Task | Dependencies | Parallelizable? |
|------|-------------|-----------------|
| README rewrite | None | First task in Phase A |
| BUTTERFREEZONE regen | README (for description alignment) | After README |
| ECOSYSTEM.md | None | Parallel with README |
| API-QUICKSTART | README identity (for naming) | Phase B, after Phase A |
| API-REFERENCE | API-QUICKSTART (stable subset) | After quick-start stable subset |
| IaC docs | None | Phase C, parallel with Phase B |
| CLI docs | None | Phase B, parallel with API docs |
| DEVELOPER-GUIDE | All other docs (for index) | Phase D |

---

## 9. Testing & Validation

### 9.1 RTFM Validation Pipeline

The final quality gate. Checks:

1. **Citation validity:** Every `<!-- cite: ... -->` tag points to an existing file (local) or resolvable ref (cross-repo). Parser: regex `<!-- cite: (\S+?)(?:@(\S+?))?:(\S+?)(?:#L(\d+)(?:-L(\d+))?)? -->`
2. **Naming compliance:** Zero "Arrakis" in zero-tolerance files
3. **Version consistency:** Package.json version matches README badge and BUTTERFREEZONE
4. **Cross-link integrity:** Every document link resolves to an existing file
5. **Cross-repo citation stability:** `grep -P 'github\.com.*/(tree|blob)/(main|develop|master)' docs/*.md` returns 0 matches — all cross-repo links must be commit-SHA permalinks
6. **Completeness:** No `TODO`, `TBD`, or `PLACEHOLDER` in shipped docs
7. **BUTTERFREEZONE hash validation:** All section hashes match via `butterfreezone-validate.sh`
8. **Route index completeness:** `scripts/extract-routes.sh --count` >= baseline route count

### 9.2 Smoke-Test Protocol

For API docs validation:

```bash
# 1. Start local instance
npm run dev &
sleep 5

# 2. Run smoke-test checklist from API-QUICKSTART.md
# Each curl command must return expected status code

# 3. Health check (no auth)
curl -s http://localhost:3000/api/agents/health | jq .status
# Expected: "ok" or similar

# 4. JWKS endpoint (no auth)
curl -s http://localhost:3000/.well-known/jwks.json | jq .keys
# Expected: array of JWK objects

# 5. Auth-required endpoints (with JWT)
curl -s -H "Authorization: Bearer $JWT" http://localhost:3000/api/agents/budget
# Expected: 200 with budget object

# 6. Kill local instance
kill %1
```

---

## 10. Technical Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Route extraction misses patterns | Medium | Medium | Supported-pattern spec + unresolvable linter gate + runtime introspection cross-check + snapshot diff |
| BUTTERFREEZONE extraction non-determinism across OS | Medium | Medium | `LC_ALL=C sort` for file lists, LF normalization, pinned jq/ts-morph/Node versions, cross-platform golden tests |
| BUTTERFREEZONE gen/validate share broken logic | Low | High | Fail-closed error taxonomy (exit 10-13), minimum-section requirement, golden fixture vectors |
| Naming migration misses references in linked docs | Medium | Medium | Grep validation covers all zero-tolerance files |
| API docs describe behavior that differs from actual routes | Medium | High | Smoke-test checklist + Tier 2 automated contract checks (auth + status code) |
| Stable endpoint contract broken without notice | Low | High | Stability contract with 2-cycle deprecation, `Sunset` header, API-CHANGELOG.md |
| Citation pinning fails due to GitHub API limits | Medium | Low | Retry/backoff, rate limit awareness, offline `--validate-only` mode, SHA caching |
| AUTH_BYPASS reaches production | Low | Critical | Code-level environment gate, startup check, production build exclusion |
| Ecosystem stats become stale before publication | Medium | Low | Stats include `generated_at` and commit SHA; 7-day TTL cache; `--fresh` flag |
| Phase A takes >3 days | Low | Medium | Circuit breaker: descope Phase C to document-only (no diagrams) |

---

## 11. Future Considerations

### 11.1 OpenAPI Generation

When code-level changes allow (out of scope for this cycle), generate OpenAPI 3.1 spec from Zod schemas using `zod-to-openapi`. This would:
- Auto-generate API-REFERENCE.md from the spec
- Enable interactive docs (Scalar, Redocly)
- Provide SDK type generation

### 11.2 Hosted Documentation Site

The `sites/docs/` directory exists but is unused. Future consideration: deploy a dedicated docs site (Mintlify, Docusaurus, or Astro Starlight) with:
- Versioned documentation
- Search
- Interactive API explorer
- Multi-language SDK examples

### 11.3 Code-Level Naming Migration

A separate engineering cycle to rename code internals from Dune to Neuromancer naming. Scope: variable names, import paths, configuration keys. Requires careful TypeScript refactoring and full test suite validation.
