# Railway plan-gate bootstrap

The credentialed gate cannot attest to the same change that creates its trust
root. The first merge that adds `.github/workflows/railway-plan-gate.yml`,
`.railway/plan-gate.mjs`, and `.railway/trusted-tools/` is therefore bootstrap
only:

1. Review the exact PR head with Bridgebuilder.
2. From a trusted operator checkout, run `railway config plan --json` and the
   gate without applying. Record only the pass/fail receipt; never copy plan
   values or credentials into the PR.
3. Merge the bootstrap only when the read-only plan has no destructive change
   and the committed baseline matches.
4. On `main`, create the protected `railway-plan` environment with required
   reviewers, move `RAILWAY_TOKEN` into that environment, and require the
   `railway-plan-gate` commit status for branch protection.
5. Every later Railway change is marked pending on its exact PR head and must
   receive a protected manual plan status for that same SHA.

The workflow fails closed when the default branch lacks any trusted evaluator
or tool-lock file. It never falls back to code from the reviewed PR.
