<!-- AGENT-CONTEXT
name: arrakis
type: framework
purpose: No description available
key_files: [.claude/loa/CLAUDE.loa.md, .loa.config.yaml, .claude/scripts/, package.json]
version: v6.0.0
trust_level: grounded
-->

# arrakis

<!-- provenance: DERIVED -->
No description available

## Key Capabilities
<!-- provenance: DERIVED -->
- `.claude/adapters/cheval.py:_build_provider_config`
- `.claude/adapters/cheval.py:_error_json`
- `.claude/adapters/cheval.py:_load_persona`
- `.claude/adapters/cheval.py:cmd_invoke`
- `.claude/adapters/cheval.py:cmd_print_config`
- `.claude/adapters/cheval.py:cmd_validate_bindings`
- `.claude/adapters/cheval.py:main`
- `.claude/adapters/loa_cheval/config/interpolation.py:LazyValue`
- `.claude/adapters/loa_cheval/config/interpolation.py:_check_env_allowed`
- `.claude/adapters/loa_cheval/config/interpolation.py:_check_file_allowed`
- `.claude/adapters/loa_cheval/config/interpolation.py:_get_credential_provider`
- `.claude/adapters/loa_cheval/config/interpolation.py:_matches_lazy_path`
- `.claude/adapters/loa_cheval/config/interpolation.py:_reset_credential_provider`
- `.claude/adapters/loa_cheval/config/interpolation.py:_resolve_env`
- `.claude/adapters/loa_cheval/config/interpolation.py:interpolate_config`
- `.claude/adapters/loa_cheval/config/interpolation.py:interpolate_value`
- `.claude/adapters/loa_cheval/config/interpolation.py:redact_config`
- `.claude/adapters/loa_cheval/config/loader.py:_deep_merge`
- `.claude/adapters/loa_cheval/config/loader.py:_find_project_root`
- `.claude/adapters/loa_cheval/config/loader.py:load_system_defaults`
- `.claude/commands/scripts/common.sh:check_audit_prerequisites`
- `.claude/commands/scripts/common.sh:check_dir_exists`
- `.claude/commands/scripts/common.sh:check_file_exists`
- `.claude/commands/scripts/common.sh:check_implement_prerequisites`
- `.claude/commands/scripts/common.sh:check_review_prerequisites`
- `.claude/commands/scripts/common.sh:check_reviewer_report`
- `.claude/commands/scripts/common.sh:check_senior_approval`
- `.claude/commands/scripts/common.sh:check_setup_complete`
- `.claude/commands/scripts/common.sh:check_sprint_dir`
- `.claude/commands/scripts/common.sh:check_sprint_in_plan`

## Architecture
<!-- provenance: DERIVED -->
Directory structure:
```
./apps
./apps/gateway
./apps/ingestor
./apps/worker
./decisions
./docs
./docs/architecture
./docs/gaib
./docs/integration
./docs/planning
./docs/proposals
./docs/research
./docs/runbook
./drizzle
./drizzle/migrations
./evals
./evals/baselines
./evals/fixtures
./evals/graders
./evals/harness
./evals/results
./evals/suites
./evals/tasks
./evals/tests
./grimoires
./grimoires/loa
./grimoires/pub
./infrastructure
./infrastructure/k8s
./infrastructure/migrations
```

## Interfaces
<!-- provenance: DERIVED -->
### HTTP Routes
themes/sietch/src/api/middleware.ts:397: * router.get('/admin/stats', (req, res) => { ... });
themes/sietch/src/api/middleware/auth.ts:176: * router.get('/protected', (req, res) => {
themes/sietch/src/api/middleware/auth.ts:382: * router.patch('/:userId/thresholds', requireAuth, requireQARole, handler);
themes/sietch/src/api/middleware/auth.ts:417: * router.delete('/sandbox/:sandboxId/reset', requireAuth, requireAdminRole, handler);
themes/sietch/src/api/middleware/dashboardAuth.ts:125:   * router.get('/config', requireDashboardAuth, handler);
themes/sietch/src/api/middleware/dashboardAuth.ts:217:   * router.post('/config', requireDashboardAuth, liveAdminCheck, handler);
themes/sietch/src/api/middleware/rate-limit.ts:367: * router.post('/endpoint', writeLimiter, handler);
themes/sietch/src/api/routes/admin/agent-config.ts:139:  router.get(
themes/sietch/src/api/routes/admin/agent-config.ts:162:  router.put(
themes/sietch/src/api/routes/admin/agent-config.ts:210:  router.post(
themes/sietch/src/api/routes/admin/agent-config.ts:247:  router.post(
themes/sietch/src/api/routes/admin/byok.routes.ts:109:  router.post(
themes/sietch/src/api/routes/admin/byok.routes.ts:147:  router.get(
themes/sietch/src/api/routes/admin/byok.routes.ts:164:  router.delete(
themes/sietch/src/api/routes/admin/byok.routes.ts:189:  router.post(
themes/sietch/src/api/routes/agents.routes.ts:142:  router.get('/.well-known/jwks.json', (req: Request, res: Response) => {
themes/sietch/src/api/routes/agents.routes.ts:193:  router.get('/api/agents/health', setDefaultRateLimitPolicy, killSwitch(agentEnabled), async (_req: Request, res: Response) => {
themes/sietch/src/api/routes/agents.routes.ts:211:  router.post('/api/agents/invoke', ...authMiddlewares, async (req: Request, res: Response) => {
themes/sietch/src/api/routes/agents.routes.ts:243:  router.post('/api/agents/stream', ...authMiddlewares, async (req: Request, res: Response) => {
themes/sietch/src/api/routes/agents.routes.ts:336:  router.get('/api/agents/models', ...authMiddlewares, (req: Request, res: Response) => {

### CLI Commands
packages/cli/src/commands/auth/index.ts:113:    .command('login')
packages/cli/src/commands/auth/index.ts:130:    .command('logout')
packages/cli/src/commands/auth/index.ts:145:    .command('whoami')
packages/cli/src/commands/sandbox/index.ts:78:    .command('new [name]')
packages/cli/src/commands/sandbox/index.ts:97:    .command('ls')
packages/cli/src/commands/sandbox/index.ts:116:    .command('rm <name>')
packages/cli/src/commands/sandbox/index.ts:134:    .command('env <name>')
packages/cli/src/commands/sandbox/index.ts:151:    .command('link <sandbox> <guildId>')
packages/cli/src/commands/sandbox/index.ts:168:    .command('unlink <sandbox> <guildId>')
packages/cli/src/commands/sandbox/index.ts:185:    .command('status <name>')

### Skill Commands
- `/auditing-security`
- `/autonomous-agent`
- `/bridgebuilder-review`
- `/browsing-constructs`
- `/bug-triaging`
- `/butterfreezone-gen`
- `/continuous-learning`
- `/deploying-infrastructure`
- `/designing-architecture`
- `/discovering-requirements`
- `/enhancing-prompts`
- `/eval-running`
- `/flatline-knowledge`
- `/flatline-reviewer`
- `/flatline-scorer`
- `/flatline-skeptic`
- `/gpt-reviewer`
- `/implementing-tasks`
- `/managing-credentials`
- `/mounting-framework`
- `/planning-sprints`
- `/red-teaming`
- `/reviewing-code`
- `/riding-codebase`
- `/rtfm-testing`
- `/run-bridge`
- `/run-mode`
- `/simstim-workflow`
- `/translating-for-executives`

## Module Map
<!-- provenance: DERIVED -->
| Module | Files | Purpose |
|--------|-------|---------|
| `apps/` | 34983 |  |
| `decisions/` | 6 |  |
| `docs/` | 28 | Documentation |
| `drizzle/` | 1 |  |
| `evals/` | 122 |  |
| `grimoires/` | 962 | Loa state files |
| `infrastructure/` | 181 |  |
| `packages/` | 57581 |  |
| `scripts/` | 10 | Utility scripts |
| `sites/` | 28151 |  |
| `tests/` | 79 | Test suites |
| `themes/` | 65825 |  |

## Ecosystem
<!-- provenance: OPERATIONAL -->
### Dependencies
- `@0xhoneyjar/loa-hounfour`
- `@types/express`
- `@types/supertest`
- `ajv`
- `ajv-formats`
- `aws-embedded-metrics`
- `express`
- `jose`
- `supertest`

## Quick Start
<!-- provenance: OPERATIONAL -->
## Quick Start

```bash
# Clone
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis

# Install dependencies
npm install

# Set up environment
cp themes/sietch/.env.example themes/sietch/.env
# Edit .env with your Discord bot token, database URL, etc.

# Run database migrations
cd themes/sietch
npx drizzle-kit push

# Start development server
<!-- ground-truth-meta
head_sha: 0d28fb4745ea21efb605b515eebb944076c5c875
generated_at: 2026-02-15T05:56:20Z
generator: butterfreezone-gen v1.0.0
sections:
  agent_context: de6f6bb02d57dbbca499e864ef92bd6730bae8b2256fd306e4c4d147e8cc602e
  capabilities: fb6ef381fb7c2032e949e99a675dae0b4d58aabe935aec3c9c48c362594e9ca7
  architecture: ac0df8c3054b47de4a589106e66d40cd9ac67a53a68f20b02cef3ce1bed2beea
  interfaces: ad3885132bd141b5cc8707fa779d267bfe28bcd3fafb5b0bcf1d9f3b32bb71af
  module_map: b484b528e883480d5f91f82d452ea6aca6fce42cd271944ac331e379f2792a44
  ecosystem: 29fc390a2a77ec8d5bdbe657182dd47a2a5cd0c0c36c74c763c9e65cfad170e3
  quick_start: e26d726aebbf5e8317bee1b55fe4e7979ca39f8a9eee91f7c3b47373a268ff8d
-->
