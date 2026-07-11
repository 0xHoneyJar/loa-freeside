# shadow-audit-api — Railway-deployable Hono building (the Shadow Access Audit's HTTP surface).
#
# Build context: the loa-freeside repo ROOT (not this subdir) — the service consumes
# @freeside/adapters + @freeside/shadow-audit-protocol via file: links, and @freeside/adapters in turn
# consumes @freeside/core (file:../core), so ALL THREE must be in the build context.
#
# Railway: in this service's settings set
#   Root Directory: packages/services/shadow-audit
#   Build Context:  <repo-root>
# OR rely on railway.toml's dockerfilePath (relative to repo root).
#
# tsx runs the service + protocol from source (the protocol exports ./src). @freeside/core and
# @freeside/adapters export dist/, so both are BUILT here (core first — adapters depends on it).

FROM node:22.12-alpine AS base
WORKDIR /app
# pnpm via npm, NOT corepack: node:22.12's bundled corepack has stale signature keys and fails pnpm's
# integrity check ("Cannot find matching keyid") on Railway's builder. Matches the sibling ordering Dockerfile.
RUN npm install -g pnpm@9.15.9

# Stage the transitive file: dependency tree: core <- adapters <- service (+ protocol).
# (F1: packages/core was previously omitted, so the adapters install — which has file:../core — failed.)
COPY packages/core ./packages/core
COPY packages/adapters ./packages/adapters
COPY packages/protocol/shadow-audit ./packages/protocol/shadow-audit
COPY packages/services/shadow-audit ./packages/services/shadow-audit

# Build @freeside/core FIRST — @freeside/adapters resolves @freeside/core from its dist/ (exports point there).
WORKDIR /app/packages/core
RUN pnpm install --no-frozen-lockfile && pnpm build

# Then @freeside/adapters — the service resolves @freeside/adapters/sonar from its dist/.
WORKDIR /app/packages/adapters
RUN pnpm install --no-frozen-lockfile && pnpm build

# Install the service (links the built core+adapters dist + the protocol src; brings tsx + zod + hono).
# (F2: tsx + zod are runtime deps of bin/http.ts and now live in `dependencies`, so a production install keeps them.)
WORKDIR /app/packages/services/shadow-audit
RUN pnpm install --no-frozen-lockfile

# loa:shortcut: --no-frozen-lockfile (F3) — the repo's npm/pnpm split means per-package lockfiles can lag the
#   workspace; a frozen install would break the build. Upgrade trigger: once the per-package pnpm-lock.yaml
#   files are kept in CI-verified sync, switch all three installs to --frozen-lockfile for a reproducible artifact.

ENV NODE_ENV=production
# Railway sets $PORT; bin/http.ts binds 0.0.0.0:$PORT (default 3040 in local dev).
EXPOSE 3040
CMD ["pnpm", "start"]
