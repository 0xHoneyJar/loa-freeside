# Arrakis Gateway - Multi-stage Rust build
# Sprint S-4: Twilight Gateway Core
# Optimized for minimal image size (<50MB target)

# Build stage
FROM rust:1.89-alpine AS builder

# Install build dependencies
RUN apk add --no-cache build-base musl-dev pkgconf openssl-dev openssl-libs-static ca-certificates

WORKDIR /app

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock* ./

# Create dummy main.rs to build dependencies
RUN mkdir -p src && \
    echo "fn main() {}" > src/main.rs && \
    cargo build --release --locked && \
    rm -rf src

# Copy actual source code
COPY src ./src

# Build the actual application with optimizations
RUN touch src/main.rs && cargo build --release --locked

# Verify binary size
RUN ls -lh target/release/arrakis-gateway

# Runtime stage - scratch-based for minimal size
FROM alpine:3.19 AS runtime

# Install minimal runtime dependencies
RUN apk add --no-cache ca-certificates tzdata && \
    rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 gateway && \
    adduser -u 1001 -G gateway -D gateway

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/target/release/arrakis-gateway /app/arrakis-gateway

# Change ownership
RUN chown -R gateway:gateway /app

# Switch to non-root user
USER gateway

# Expose HTTP port (health, ready, metrics)
EXPOSE 9090

# Labels per OCI spec
LABEL org.opencontainers.image.title="Arrakis Gateway" \
      org.opencontainers.image.description="Rust Discord Gateway using Twilight" \
      org.opencontainers.image.version="0.2.0" \
      org.opencontainers.image.vendor="The Honey Jar" \
      org.opencontainers.image.source="https://github.com/0xHoneyJar/arrakis"

# Kubernetes probes will use /health and /ready endpoints
# Docker healthcheck for local development
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:9090/health || exit 1

# Run the gateway
ENTRYPOINT ["/app/arrakis-gateway"]
