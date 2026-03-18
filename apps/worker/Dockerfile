# =============================================================================
# GP Worker Production Dockerfile
# =============================================================================
# Multi-stage build for the NATS-based message consumer worker.
# Build from repo root: docker build -f apps/worker/Dockerfile .
#
# Dependencies:
#   @arrakis/core       - Domain types and port interfaces
#   @arrakis/adapters   - Agent gateway, budget manager, tier access (relative imports)
#   @arrakis/sandbox    - Sandbox execution environment
#   @arrakis/nats-schemas - NATS wire format schemas
# =============================================================================

FROM node:20-alpine AS builder

WORKDIR /repo

# ============================================
# Step 1: Install Worker Dependencies First
# (Provides shared deps: ioredis, nats, pino)
# ============================================
WORKDIR /repo/apps/worker
COPY apps/worker/package.json apps/worker/package-lock.json* ./
RUN npm ci --ignore-scripts || npm install --ignore-scripts

# ============================================
# Step 2: Build @arrakis/core
# ============================================
WORKDIR /repo/packages/core
COPY packages/core/package.json packages/core/package-lock.json* ./
RUN npm ci || npm install
COPY packages/core/domain ./domain
COPY packages/core/ports ./ports
COPY packages/core/tsconfig.json ./
RUN npm run build

# ============================================
# Step 3: Build @arrakis/adapters
# (Agent gateway, budget manager, pool mapping)
# ============================================
WORKDIR /repo/packages/adapters
COPY packages/adapters/package*.json ./
RUN npm ci --ignore-scripts
COPY packages/adapters/tsconfig.json ./
COPY packages/adapters/chain ./chain
COPY packages/adapters/storage ./storage
COPY packages/adapters/themes ./themes
COPY packages/adapters/wizard ./wizard
COPY packages/adapters/synthesis ./synthesis
COPY packages/adapters/security ./security
COPY packages/adapters/coexistence ./coexistence
COPY packages/adapters/agent ./agent
RUN npm run build
# Copy Lua scripts (used by budget-manager.ts via readFileSync at runtime)
RUN cp -r /repo/packages/adapters/agent/lua /repo/packages/adapters/dist/agent/lua
# Replace source .ts with compiled .js + .d.ts in agent/ so that the worker's
# relative path imports (../../../packages/adapters/agent/budget-manager.js)
# resolve to declarations (.d.ts) instead of source (.ts), avoiding rootDir violations.
RUN cd /repo/packages/adapters && \
    find agent -maxdepth 1 -name '*.ts' -not -name '*.d.ts' -delete && \
    cp dist/agent/*.js dist/agent/*.d.ts agent/ 2>/dev/null; \
    cp -r dist/agent/lua agent/ 2>/dev/null; true

# ============================================
# Step 4: Build @arrakis/nats-schemas
# (NATS wire format types shared with gateway)
# ============================================
WORKDIR /repo/packages/shared/nats-schemas
COPY packages/shared/nats-schemas/package*.json ./
RUN npm install --ignore-scripts typescript
COPY packages/shared/nats-schemas/tsconfig.json ./
COPY packages/shared/nats-schemas/src ./src
COPY packages/shared/nats-schemas/nats-routing.json ./
# Build: nats-schemas exports TS source but we need JS for runtime
RUN npx tsc --outDir dist

# ============================================
# Step 5: Build @arrakis/sandbox
# ============================================
WORKDIR /repo/packages/sandbox
COPY packages/sandbox/package.json packages/sandbox/package-lock.json* ./
RUN mkdir -p node_modules/@arrakis && \
    ln -sf /repo/packages/core node_modules/@arrakis/core && \
    ln -sf /repo/apps/worker/node_modules/ioredis node_modules/ioredis && \
    ln -sf /repo/apps/worker/node_modules/nats node_modules/nats && \
    ln -sf /repo/apps/worker/node_modules/pino node_modules/pino && \
    ln -sf /repo/apps/worker/node_modules/prom-client node_modules/prom-client && \
    ln -sf /repo/apps/worker/node_modules/drizzle-orm node_modules/drizzle-orm && \
    ln -sf /repo/apps/worker/node_modules/postgres node_modules/postgres
RUN npm install --ignore-scripts nanoid typescript 2>/dev/null || true
COPY packages/sandbox/src ./src
COPY packages/sandbox/tsconfig.json ./
RUN npm run build

# ============================================
# Step 6: Build Worker
# ============================================
WORKDIR /repo/apps/worker

# Link all workspace packages for tsc resolution
RUN mkdir -p node_modules/@arrakis && \
    ln -sf /repo/packages/core node_modules/@arrakis/core && \
    ln -sf /repo/packages/sandbox node_modules/@arrakis/sandbox && \
    ln -sf /repo/packages/adapters node_modules/@arrakis/adapters && \
    ln -sf /repo/packages/shared/nats-schemas node_modules/@arrakis/nats-schemas

COPY apps/worker/src ./src
COPY apps/worker/tsconfig.json ./
RUN npm run build

# ============================================
# Production stage
# ============================================
FROM node:20-alpine AS production

RUN addgroup -g 1001 -S worker && \
    adduser -u 1001 -S worker -G worker

WORKDIR /app

# Copy package files
COPY apps/worker/package.json apps/worker/package-lock.json* ./

# Copy node_modules from builder (includes third-party deps).
# Workspace @arrakis/* packages are broken symlinks pointing to builder paths —
# delete them, then overlay built content as real directories.
COPY --from=builder /repo/apps/worker/node_modules ./node_modules
RUN rm -f node_modules/@arrakis/core node_modules/@arrakis/sandbox \
         node_modules/@arrakis/adapters node_modules/@arrakis/nats-schemas

# Overlay built workspace packages into node_modules (real directories now)
COPY --from=builder /repo/packages/core/dist ./node_modules/@arrakis/core/dist
COPY --from=builder /repo/packages/core/package.json ./node_modules/@arrakis/core/
COPY --from=builder /repo/packages/sandbox/dist ./node_modules/@arrakis/sandbox/dist
COPY --from=builder /repo/packages/sandbox/package.json ./node_modules/@arrakis/sandbox/
COPY --from=builder /repo/packages/adapters/dist ./node_modules/@arrakis/adapters/dist
COPY --from=builder /repo/packages/adapters/package.json ./node_modules/@arrakis/adapters/
COPY --from=builder /repo/packages/shared/nats-schemas/dist ./node_modules/@arrakis/nats-schemas/dist
COPY --from=builder /repo/packages/shared/nats-schemas/nats-routing.json ./node_modules/@arrakis/nats-schemas/
COPY --from=builder /repo/packages/shared/nats-schemas/package.json ./node_modules/@arrakis/nats-schemas/
# Rewrite nats-schemas entry points from src/ (TS) to dist/ (JS) for runtime
RUN sed -i 's|src/index.ts|dist/index.js|g' ./node_modules/@arrakis/nats-schemas/package.json

# Prune dev dependencies
RUN npm prune --production 2>/dev/null; npm cache clean --force 2>/dev/null; true

# Copy built worker
COPY --from=builder /repo/apps/worker/dist ./dist

# Worker uses relative path imports to packages/adapters/agent/*.js at runtime.
# These resolve from /app/dist/ up to /packages/adapters/agent/.
# Copy compiled JS + Lua scripts to where the relative imports resolve.
COPY --from=builder /repo/packages/adapters/dist/agent /packages/adapters/agent
COPY --from=builder /repo/packages/adapters/dist/agent/lua /packages/adapters/agent/lua

# ESM resolution walks up from /packages/adapters/agent/ looking for node_modules.
# Copy adapters' third-party deps (jose, zod, etc.) so they resolve directly.
# Remove broken @arrakis/* workspace symlinks, then symlink to /app's copies.
COPY --from=builder /repo/packages/adapters/node_modules /packages/adapters/node_modules
RUN rm -rf /packages/adapters/node_modules/@arrakis && \
    mkdir -p /packages/adapters/node_modules/@arrakis && \
    ln -sf /app/node_modules/@arrakis/core /packages/adapters/node_modules/@arrakis/core && \
    ln -sf /app/node_modules/@arrakis/nats-schemas /packages/adapters/node_modules/@arrakis/nats-schemas
# Fallback symlink for any deps not in adapters' node_modules
RUN ln -sf /app/node_modules /packages/node_modules

RUN chown -R worker:worker /app /packages
USER worker

ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
