FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate

# Workspace setup — Cycle C P3 added packages/beacon-schema as workspace pkg.
# pnpm-workspace.yaml + packages/ must be present for `workspace:*` resolution.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
RUN pnpm install --no-frozen-lockfile

# Build the workspace package first (gateway tsc imports its compiled output)
RUN pnpm --filter @0xhoneyjar/beacon-schema build

# Now build the gateway
COPY tsconfig.json ./
COPY src ./src
COPY bin ./bin
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate

# Runtime needs workspace topology for pnpm install to resolve workspace:*
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
RUN pnpm install --prod --no-frozen-lockfile
# Bring the built workspace package + gateway dist
COPY --from=builder /app/packages/beacon-schema/dist ./packages/beacon-schema/dist
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/bin/http.js"]
