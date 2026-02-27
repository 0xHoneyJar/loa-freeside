# =============================================================================
# Sietch Service Production Dockerfile
# =============================================================================
# Multi-stage build for minimal production image
# Target: ~200MB final image with security hardening
#
# NOTE: This Dockerfile MUST be built from the monorepo root to include
# the @arrakis/adapters and @arrakis/core local dependencies.
#
# Build: docker build -t arrakis-sietch:latest -f themes/sietch/Dockerfile .
# Run:   docker run -p 3000:3000 --env-file .env arrakis-sietch:latest
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

# Install build dependencies for native modules (bcrypt, sharp, better-sqlite3)
# Full build toolchain including node-gyp dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    vips-dev \
    pkgconfig \
    && npm install -g node-gyp typescript

# -----------------------------------------------------------------------------
# Build monorepo workspace dependencies first
# Sietch depends on @arrakis/adapters which depends on @arrakis/core
# Maintain the same directory structure as the repo for file: dependencies
# -----------------------------------------------------------------------------

# Create the monorepo structure
WORKDIR /repo

# Copy and build @arrakis/core
COPY packages/core/package*.json ./packages/core/
WORKDIR /repo/packages/core
RUN npm ci --ignore-scripts
COPY packages/core/tsconfig.json ./
COPY packages/core/ports ./ports
COPY packages/core/domain ./domain
RUN npm run build

# Copy and build @arrakis/adapters
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

# -----------------------------------------------------------------------------
# Now build Sietch with the built workspace dependencies
# Working directory is themes/sietch to match file:../../packages/adapters path
# -----------------------------------------------------------------------------
WORKDIR /repo/themes/sietch

# Copy package files for Sietch
COPY themes/sietch/package*.json ./

# Install dependencies with --ignore-scripts to prevent native module failures,
# then rebuild each native module individually.
RUN npm ci --ignore-scripts

# Sharp: install the prebuilt binary for Alpine (linux-musl-x64) using the
# platform-specific optional dependency, then rebuild to link against system vips.
RUN npm install --no-save @img/sharp-linux-x64 2>/dev/null; \
    npm rebuild sharp --build-from-source 2>/dev/null || true

# Rebuild other native modules that need compilation
RUN npm rebuild bcrypt
RUN npm rebuild better-sqlite3

# Copy source code and TypeScript configs
COPY themes/sietch/tsconfig.json themes/sietch/tsconfig.production.json ./
COPY themes/sietch/src ./src
COPY themes/sietch/drizzle ./drizzle
COPY themes/sietch/drizzle.config.ts ./

# Copy TypeScript declaration stubs for packages/services/ relative imports.
# Route files use ../../../../packages/services/ which resolves to themes/packages/services/.
COPY themes/packages/services /repo/themes/packages/services

# Build TypeScript
RUN npm run build

# Copy static files to dist (not compiled by TypeScript)
RUN cp -r src/static dist/static 2>/dev/null || true

# Prune dev dependencies for smaller production image
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 2: Production
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Metadata labels (OCI standard)
LABEL org.opencontainers.image.title="Sietch Service"
LABEL org.opencontainers.image.description="Token-gated Discord community service for BGT holders"
LABEL org.opencontainers.image.vendor="0xHoneyJar"
LABEL org.opencontainers.image.version="6.0.0"
LABEL org.opencontainers.image.source="https://github.com/0xHoneyJar/arrakis"

WORKDIR /app

# Install runtime dependencies only
# - vips: Sharp image processing runtime
# - curl: Health check endpoint
# - dumb-init: Proper signal handling for Node.js
RUN apk add --no-cache vips curl dumb-init && \
    rm -rf /var/cache/apk/*

# Create non-root user with specific UID/GID for Kubernetes compatibility
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy built application with correct ownership
COPY --from=builder --chown=nodejs:nodejs /repo/themes/sietch/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /repo/themes/sietch/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /repo/themes/sietch/package.json ./
COPY --from=builder --chown=nodejs:nodejs /repo/themes/sietch/drizzle ./drizzle
COPY --from=builder --chown=nodejs:nodejs /repo/themes/sietch/drizzle.config.ts ./

# Copy workspace dependencies (@arrakis/adapters and @arrakis/core)
# These are file: dependencies that need to be at the correct relative path
# The package.json has "file:../../packages/adapters" so from /app, they need to be at /packages/
COPY --from=builder --chown=nodejs:nodejs /repo/packages/core /packages/core
COPY --from=builder --chown=nodejs:nodejs /repo/packages/adapters /packages/adapters

# Security: Remove unnecessary files from node_modules
# Note: Be careful not to remove package directories named "test" (e.g., viem/_esm/actions/test)
RUN find node_modules -name "*.md" -delete 2>/dev/null || true && \
    find node_modules -name "*.ts" -not -path "*/node_modules/.pnpm/*" -delete 2>/dev/null || true && \
    find node_modules -name ".git*" -delete 2>/dev/null || true && \
    find node_modules -maxdepth 2 -name "__tests__" -type d -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -maxdepth 2 -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -maxdepth 2 -name "docs" -type d -exec rm -rf {} + 2>/dev/null || true

# Set production environment
ENV NODE_ENV=production \
    API_PORT=3000 \
    API_HOST=0.0.0.0 \
    # Node.js production optimizations
    NODE_OPTIONS="--max-old-space-size=512 --enable-source-maps"

# Switch to non-root user
USER nodejs

# Expose API port
EXPOSE 3000

# Health check with appropriate intervals for production
# - interval: 30s between checks
# - timeout: 5s max for health endpoint response
# - start-period: 60s grace period during startup
# - retries: 3 failures before marking unhealthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use dumb-init for proper signal handling (SIGTERM, SIGINT)
# This ensures graceful shutdown in Kubernetes/ECS
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/index.js"]

# -----------------------------------------------------------------------------
# Stage 3: E2E Testing
# -----------------------------------------------------------------------------
# Extends production with JWKS export capability for Docker Compose E2E tests.
# Writes JWKS to a shared volume on startup so loa-finn can read it without
# an HTTP fetch (breaks circular dependency).
#
# Build: docker build --target e2e -f themes/sietch/Dockerfile .
# -----------------------------------------------------------------------------
FROM production AS e2e

USER root
# Install jq for JWKS JSON validation in e2e-entrypoint.sh (R9-3)
RUN apk add --no-cache jq
COPY tests/e2e/e2e-entrypoint.sh /app/e2e-entrypoint.sh
RUN chmod +x /app/e2e-entrypoint.sh
USER nodejs

CMD ["/app/e2e-entrypoint.sh"]
