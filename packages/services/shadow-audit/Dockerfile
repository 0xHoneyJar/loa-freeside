# shadow-audit-api — Railway-deployable Hono building (the Shadow Access Audit's HTTP surface).
#
# Build context: the loa-freeside repo ROOT (not this subdir) — the service consumes
# @freeside/adapters + @freeside/shadow-audit-protocol via file: links, so both must be in
# the build context.
#
# Railway: in this service's settings set
#   Root Directory: packages/services/shadow-audit
#   Build Context:  <repo-root>
# OR rely on railway.toml's dockerfilePath (relative to repo root).
#
# tsx runs the service + protocol from source; @freeside/adapters is consumed from its built
# dist (its package exports point to dist/), so it is the one package built here.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Stage the service + its file: dependencies.
COPY packages/adapters ./packages/adapters
COPY packages/protocol/shadow-audit ./packages/protocol/shadow-audit
COPY packages/services/shadow-audit ./packages/services/shadow-audit

# Build @freeside/adapters so the service resolves @freeside/adapters/sonar from dist/.
WORKDIR /app/packages/adapters
RUN pnpm install --no-frozen-lockfile && pnpm build

# Install the service (links the built adapters dist + the protocol src; brings tsx + hono).
WORKDIR /app/packages/services/shadow-audit
RUN pnpm install --no-frozen-lockfile

ENV NODE_ENV=production
# Railway sets $PORT; bin/http.ts binds 0.0.0.0:$PORT (default 3040 in local dev).
EXPOSE 3040
CMD ["pnpm", "start"]
