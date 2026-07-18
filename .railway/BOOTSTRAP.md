# Railway plan-gate bootstrap

The credentialed gate cannot attest to the same change that creates its trust
root. The first merge that adds `.github/workflows/railway-plan-gate.yml`,
`.railway/plan-gate.mjs`, and `.railway/trusted-tools/` is therefore bootstrap
only. It contains no active `.railway/railway.ts`. The resource declaration
under `.railway/trusted-tools/railway.ts` is a dormant trust-root copy: the CLI
does not discover it automatically, and the bootstrap never executes it:

1. Review the exact PR head with Bridgebuilder.
2. Confirm the workflow contains no apply path and the bootstrap diff contains
   no Railway resource declaration.
3. Merge the bootstrap only after its exact-head review passes.
4. On `main`, create the protected `railway-plan` environment with required
   reviewers, move `RAILWAY_TOKEN` into that environment, and require the
   `railway-plan-gate` commit status for branch protection.
5. Every later Railway change is marked pending on its exact PR head and must
   receive a protected manual plan status for that same SHA.

The trusted evaluator is bound to Railway project
`0bf95b1c-b8f2-4e60-a4a6-50089b521eb0` and production environment
`2068efa5-0ed4-4cf3-9ae2-89120c4b18d5`. A token or checkout resolving to any
other target fails before changes are compared or logged.

The workflow fails closed when the default branch lacks any trusted evaluator,
executable config, or tool-lock file. A later Railway PR's active
`.railway/railway.ts` must be byte-identical to the default-branch trust-root
copy, but the credentialed job executes only the trusted copy. Unrelated
repository files are therefore outside the executable input closure.
