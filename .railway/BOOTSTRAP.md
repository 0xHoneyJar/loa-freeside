# Railway plan-gate bootstrap

The credentialed gate cannot attest to the same change that creates its trust
root. The first merge that adds `.github/workflows/railway-plan-gate.yml`,
`.railway/plan-gate.mjs`, and `.railway/trusted-tools/` is therefore bootstrap
only. It contains no active `.railway/railway.ts`. The resource declaration
under `.railway/trusted-tools/railway.ts` is a dormant trust-root copy: the CLI
does not discover it automatically, and the bootstrap never executes it:

1. Review the exact PR head with Bridgebuilder.
2. Confirm there is no auto-discovered active config or apply path. Review the
   dormant resource declaration in full because it becomes the executable
   default-branch trust root after merge.
3. Merge the bootstrap only after its exact-head Bridgebuilder review contains
   no critical, high, or medium findings. This is the one-time substitute for
   the not-yet-installed `railway-trust-root-review` status.
4. On `main`, create the protected `railway-plan` environment with required
   reviewers, move `RAILWAY_TOKEN` into that environment, and require the
   `railway-plan-gate` and `railway-trust-root-review` commit-status contexts
   for branch protection.
5. Every later Railway change is marked pending on its exact PR head and must
   receive the applicable exact-head status. Active IaC uses the protected
   manual plan; verifier/workflow/toolchain rotations use the independent
   Bridgebuilder attestation from a non-author maintainer/admin with no Railway
   credential. A dismissed or superseded review revokes the attestation.

The trusted evaluator is bound to Railway project
`0bf95b1c-b8f2-4e60-a4a6-50089b521eb0` and production environment
`2068efa5-0ed4-4cf3-9ae2-89120c4b18d5`. A token or checkout resolving to any
other target fails before changes are compared or logged.
Captured Railway v4.10.0 plans identify safe service and Postgres creation as
`resource.create` with `Create service <name>` and `Create database <name>`
summaries. The evaluator converts only those two strict shapes into value-free
baseline identities; other creation types fail closed until separately grounded.
Subprocess stderr, malformed JSON, and exception messages are never reflected
into CI logs; the public diagnostic surface is limited to fixed local codes such
as `PLAN_EXEC_FAILED`, `PLAN_JSON_INVALID`, and `PLAN_SCHEMA_REJECTED`.

The workflow fails closed when the default branch lacks any trusted evaluator,
executable config, or tool-lock file. A later Railway PR's active
`.railway/railway.ts` must be byte-identical to the default-branch trust-root
copy, but the credentialed job executes only the trusted copy. Unrelated
repository files are therefore outside the executable input closure.

## Trust-root rotation sequence

An intentional config rotation changes both `.railway/railway.ts` and
`.railway/trusted-tools/railway.ts` to identical bytes in one PR:

1. Both exact-head statuses begin pending.
2. A non-author maintainer/admin runs Bridgebuilder. The default-branch
   `railway-trust-root-review` validates that review without Railway credentials
   and attests the candidate SHA. That workflow also requires both config copies
   to change together and fetches them from the exact head to prove byte identity.
   Before attestation, the separate `railway-trust-root-tests` workflow runs
   under the ordinary unprivileged `pull_request` event. It executes the
   old/default regression suites against candidate verifier code, then runs the
   candidate suites too, with no write permission or Railway token. The trusted
   `pull_request_target`/`workflow_run` status publisher consumes only the
   canonical workflow-run identity, repository, exact head SHA, and conclusion;
   it never receives candidate-produced files, environment values, or command
   outputs, and it never executes PR-head code.
3. Only after that success may the protected plan run. It retains the old
   default-branch evaluator, SDK lock, and CLI checksum; it extracts the
   candidate config from the attested SHA, verifies it is byte-identical to the
   active config, then evaluates that exact candidate.
4. The PR merges only when both contexts succeed. If review is dismissed, the
   candidate changes again, or the plan fails, no trust-root state advances;
   `main` remains the rollback root.

Both status workflows reject PRs at GitHub's 3,000-file pull-files API ceiling,
where complete changed-path enumeration cannot be proven. The manual plan entry
rechecks the associated open PR and the same ceiling before credentials are
requested, so a dispatch cannot overwrite that inventory failure with success.
