# =============================================================================
# Sietch Service Production Dockerfile
# =============================================================================
# Multi-stage build for minimal production image
# Target: ~200MB final image with security hardening
#
# Build: docker build -t arrakis-sietch:latest .
# Run:   docker run -p 3000:3000 --env-file .env arrakis-sietch:latest
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (bcrypt, sharp, better-sqlite3)
# Full build toolchain including node-gyp dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    vips-dev \
    pkgconfig \
    && npm install -g node-gyp

# Copy package files first (layer caching optimization)
COPY package*.json ./

# Install dependencies with --ignore-scripts to prevent partial builds
# Then manually rebuild native modules in correct order
RUN npm ci --ignore-scripts

# Rebuild native modules that require compilation
# Sharp uses prebuilt binaries when available, falls back to node-gyp
RUN npm rebuild sharp || npm install sharp --build-from-source
RUN npm rebuild bcrypt
RUN npm rebuild better-sqlite3

# Copy source code and TypeScript configs
COPY tsconfig.json tsconfig.production.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY drizzle.config.ts ./

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
LABEL org.opencontainers.image.version="5.1.1"
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
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nodejs:nodejs /app/drizzle.config.ts ./

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
