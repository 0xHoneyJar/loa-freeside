# mcp-gateway container image.
#
# BUILD CONTEXT: the REPOSITORY ROOT — not apps/mcp-gateway/.
# cycle-049 moved the gateway off the (broken) nested `workspace:*` setup to
# `file:../../packages/*` deps (matching freeside-cli / freeside-registry).
# The file: dependency packages therefore live OUTSIDE apps/mcp-gateway/ and
# must be inside the Docker build context.
#
# Railway: set the service "Root Directory" to the repository root; keep
# railway.toml `dockerfilePath = apps/mcp-gateway/Dockerfile`.
#
# NOTE (cycle-049): this Dockerfile was reworked alongside the dep-shape
# change but the container build itself is NOT exercised by this cycle
# (the FR-6 acceptance test runs in-process via Hono `app.request()`, and
# CI runs package `tsc`/test, not a Docker build). A deploy smoke-test is
# required before the next production deploy. See grimoires/loa/NOTES.md.

FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# ── file: dependency packages — build dist/ so the gateway can import them ──
# beacon-schema first (freeside-registry depends on it via file:../beacon-schema).
COPY packages/beacon-schema ./packages/beacon-schema
RUN pnpm --dir packages/beacon-schema install --no-frozen-lockfile \
 && pnpm --dir packages/beacon-schema build
COPY packages/freeside-registry ./packages/freeside-registry
RUN pnpm --dir packages/freeside-registry install --no-frozen-lockfile \
 && pnpm --dir packages/freeside-registry build

# ── the gateway ──
COPY apps/mcp-gateway/package.json apps/mcp-gateway/pnpm-lock.yaml ./apps/mcp-gateway/
RUN pnpm --dir apps/mcp-gateway install --no-frozen-lockfile
COPY apps/mcp-gateway/tsconfig.json ./apps/mcp-gateway/
COPY apps/mcp-gateway/src ./apps/mcp-gateway/src
COPY apps/mcp-gateway/bin ./apps/mcp-gateway/bin
RUN pnpm --dir apps/mcp-gateway build

FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo
ENV NODE_ENV=production

# Bring the dependency packages (sources + built dist) and the gateway dist.
COPY packages/beacon-schema/package.json ./packages/beacon-schema/
COPY packages/freeside-registry/package.json ./packages/freeside-registry/
COPY --from=builder /repo/packages/beacon-schema/dist ./packages/beacon-schema/dist
COPY --from=builder /repo/packages/freeside-registry/dist ./packages/freeside-registry/dist
COPY apps/mcp-gateway/package.json apps/mcp-gateway/pnpm-lock.yaml ./apps/mcp-gateway/
RUN pnpm --dir apps/mcp-gateway install --prod --no-frozen-lockfile
COPY --from=builder /repo/apps/mcp-gateway/dist ./apps/mcp-gateway/dist

WORKDIR /repo/apps/mcp-gateway
EXPOSE 3000
CMD ["node", "dist/bin/http.js"]
