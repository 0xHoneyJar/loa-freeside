# freeside-operator-dash — Railway-deployable Hono app.
#
# Build context: loa-freeside repo ROOT (not the dash subdir).
# Reason: the dash consumes @0xhoneyjar/events via `file:../../packages/events`
# (relative workspace link). The Dockerfile must bring both the dash AND the
# events package into the build context.
#
# Railway setup: in the dash's Railway service settings, set:
#   Root Directory: apps/freeside-operator-dash
#   Build Context:  <repo-root>     (NOT the root directory)
# OR use railway.toml with dockerfilePath relative to repo root.

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Stage the dash's own workspace + the events package it depends on.
# The dash declares its own pnpm-workspace.yaml; the events package
# must be reachable via the file:../../packages/events link.
COPY packages/events ./packages/events
COPY apps/freeside-operator-dash ./apps/freeside-operator-dash

# Build events package first (dash's tsc resolves it from packages/events/dist).
WORKDIR /app/packages/events
RUN pnpm install --no-frozen-lockfile && pnpm build

# Build the dash.
WORKDIR /app/apps/freeside-operator-dash
RUN pnpm install --no-frozen-lockfile && pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Bring just the runtime artifacts: built events + built dash + their deps.
COPY --from=builder /app/packages/events/package.json ./packages/events/package.json
COPY --from=builder /app/packages/events/dist ./packages/events/dist
COPY --from=builder /app/packages/events/node_modules ./packages/events/node_modules

COPY --from=builder /app/apps/freeside-operator-dash/package.json ./apps/freeside-operator-dash/package.json
COPY --from=builder /app/apps/freeside-operator-dash/dist ./apps/freeside-operator-dash/dist
COPY --from=builder /app/apps/freeside-operator-dash/node_modules ./apps/freeside-operator-dash/node_modules

WORKDIR /app/apps/freeside-operator-dash

# Railway sets $PORT; the dash binds 0.0.0.0:$PORT via bin/http.ts.
# If absent in local dev, default to 3030 (matches the bin/http.ts default).
EXPOSE 3030

CMD ["node", "dist/bin/http.js"]
