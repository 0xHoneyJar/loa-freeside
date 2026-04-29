# @loa-freeside/gaib-cli

Sovereign secrets CLI — `gaib secrets pull/push/help` against AWS Secrets
Manager, resolving slugs against the `freeside-worlds` registry.

Per SDD §0 L3, this is a peer to `packages/cli` (the world-deploy surface)
— different audience, different IAM scope.

## Install

```bash
cd packages/gaib-cli
pnpm install
pnpm build
# `gaib` is now on PATH (via the workspace bin link)
```

## Usage

```bash
# Pull mibera prod as a dotenv stream
gaib secrets pull --world mibera --env prod --format dotenv > .env.cutover

# Use the secrets, then revoke the working file
unset $(grep -oE '^[A-Z_]+' .env.cutover) && rm .env.cutover

# Push rotated secrets after a flip (prod requires --confirm)
gaib secrets push --world mibera --env prod --from-file .env.rotated --confirm

# Help
gaib help
gaib secrets pull --help
```

## Authentication

Uses your existing AWS profile via `AWS_PROFILE` env or `~/.aws/credentials`.
No new IAM roles — the CLI assumes the operator already has read/write
permissions on `arrakis-{staging|production}-<slug>` Secrets Manager entries.

For sprint-1 of `mature-freeside-operator-and-cutover` cycle, use:

```bash
export AWS_PROFILE=admin    # IAM user zksoju-cli
gaib secrets pull --world mibera --env prod --format dotenv > /dev/null
# (verify it returns 0; do not actually pipe values to disk in this test)
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Unauthorized (AWS auth failure) |
| 2 | Missing world (slug not in registry) |
| 3 | Schema violation (registry mismatch, malformed JSON, etc.) |
| 4 | Retryable network error (AWS throttle / 5xx) |
| 5 | Bad invocation (missing required flag, prod-without-confirm) |

## Security

- Never logs secret VALUES; logs counts + key names only.
- Pull writes to stdout; operator is responsible for stdout routing.
- Push validates against `freeside-worlds/packages/registry/worlds/<slug>.yaml`'s
  `secrets:` array. Keys absent from the registry are rejected.
- Prod pushes require `--confirm` to defend against muscle-memory mistakes.

## Convention: AWS secret shape

Each world has ONE Secrets Manager secret per env, named:

- `arrakis-staging-<slug>`
- `arrakis-production-<slug>`

The secret's value is a JSON object — `{ "ENV_VAR": "value", ... }` — and
the keys must match the `env_var` field of every entry in the world YAML's
`secrets:` array. This mirrors the existing `scripts/load-honeyroad-secrets.sh`
pattern.

## References

- SDD §0 L3 (peer placement)
- SDD §9 (full design — package layout, commands, exit codes, auth, security)
- KRANZ persona: secrets orchestration is INLINE in `coordinating-cutover` per L8
- Project memory: `freeside-secret-management-direction`
