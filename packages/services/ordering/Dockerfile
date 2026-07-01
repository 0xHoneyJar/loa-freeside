# ordering-service — Railway-deployable Hono intake + community-onboarding orchestrator.
#
# Build context: loa-freeside repo ROOT. file: deps pull in protocol + shadow-audit-service
# (which consumes @freeside/adapters → @freeside/core).
#
# Railway service settings:
#   Root Directory: packages/services/ordering
#   Build Context:  <repo-root>

FROM node:22.12-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY packages/core ./packages/core
COPY packages/adapters ./packages/adapters
COPY packages/protocol/ordering ./packages/protocol/ordering
COPY packages/protocol/shadow-audit ./packages/protocol/shadow-audit
COPY packages/services/shadow-audit ./packages/services/shadow-audit
COPY packages/services/ordering ./packages/services/ordering

WORKDIR /app/packages/core
RUN pnpm install --no-frozen-lockfile && pnpm build

WORKDIR /app/packages/adapters
RUN pnpm install --no-frozen-lockfile && pnpm build

WORKDIR /app/packages/services/ordering
RUN pnpm install --no-frozen-lockfile

ENV NODE_ENV=production
EXPOSE 8090
CMD ["pnpm", "start"]
