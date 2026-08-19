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
RUN npm install -g pnpm@9.15.9

COPY packages/core ./packages/core
COPY packages/adapters ./packages/adapters
COPY packages/protocol/ordering ./packages/protocol/ordering
COPY packages/protocol/shadow-audit ./packages/protocol/shadow-audit
COPY packages/protocol/collection ./packages/protocol/collection
COPY packages/protocol/collection-resolution ./packages/protocol/collection-resolution
COPY packages/protocol/public-authorization ./packages/protocol/public-authorization
COPY packages/protocol/trust-envelope ./packages/protocol/trust-envelope
COPY packages/protocol/signing-key-custody ./packages/protocol/signing-key-custody
COPY packages/protocol/dependency-ledger ./packages/protocol/dependency-ledger
COPY packages/services/shadow-audit ./packages/services/shadow-audit
COPY packages/services/ordering ./packages/services/ordering

# Protocol packages that must build before the service (file: deps).
RUN for pkg in \
      packages/core \
      packages/adapters \
      packages/protocol/collection \
      packages/protocol/collection-resolution \
      packages/protocol/public-authorization \
      packages/protocol/trust-envelope \
      packages/protocol/signing-key-custody \
      packages/protocol/dependency-ledger; do \
      cd /app/$pkg && pnpm install --no-frozen-lockfile && pnpm build; \
    done

WORKDIR /app/packages/services/ordering
RUN pnpm install --no-frozen-lockfile

ENV NODE_ENV=production
EXPOSE 8090
CMD ["pnpm", "start"]
