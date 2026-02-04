# =============================================================================
# Stillsuit Development Makefile
# =============================================================================
# Self-documenting Makefile for common development operations.
#
# Usage: make <target>
# Help:  make help
# =============================================================================

.PHONY: help dev dev-build dev-logs dev-shell dev-db dev-migrate test lint clean

# Default target
.DEFAULT_GOAL := help

# Colors for output
CYAN := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RESET := \033[0m

# Docker compose file
COMPOSE := docker compose -f docker-compose.dev.yml

# =============================================================================
# Help
# =============================================================================

help: ## Show this help
	@echo ""
	@echo "$(CYAN)Stillsuit Development Commands$(RESET)"
	@echo "================================"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "$(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Quick Start:$(RESET)"
	@echo "  1. cp .env.development.example .env.development"
	@echo "  2. Edit .env.development with your Discord credentials"
	@echo "  3. make dev"
	@echo ""
	@echo "$(YELLOW)Known Limitations:$(RESET)"
	@echo "  - Only themes/sietch/src is hot-reloaded"
	@echo "  - Package changes require: make dev-build"
	@echo "  - macOS is ~8s vs Linux ~5s for hot-reload"
	@echo ""

# =============================================================================
# Development
# =============================================================================

dev: ## Start development environment
	@echo "$(CYAN)Starting Stillsuit development environment...$(RESET)"
	@if lsof -i :3000 >/dev/null 2>&1; then \
		echo "$(YELLOW)Warning: Port 3000 is in use. Stop existing services first.$(RESET)"; \
		exit 1; \
	fi
	$(COMPOSE) up

dev-build: ## Rebuild development containers (required after package/* changes)
	@echo "$(CYAN)Rebuilding development containers...$(RESET)"
	$(COMPOSE) build --no-cache

dev-logs: ## Tail development logs
	$(COMPOSE) logs -f

dev-shell: ## Open shell in sietch-dev container
	$(COMPOSE) exec sietch-dev sh

dev-db: ## Open Drizzle Studio for database exploration
	@echo "$(CYAN)Opening Drizzle Studio...$(RESET)"
	cd themes/sietch && npm run db:studio

dev-migrate: ## Run database migrations
	@echo "$(CYAN)Running database migrations...$(RESET)"
	$(COMPOSE) exec sietch-dev npx drizzle-kit migrate

# =============================================================================
# Testing
# =============================================================================

test: ## Run tests in container
	$(COMPOSE) exec sietch-dev npm test

test-coverage: ## Run tests with coverage report
	$(COMPOSE) exec sietch-dev npm run test:coverage

lint: ## Run linting
	$(COMPOSE) exec sietch-dev npm run lint

typecheck: ## Run TypeScript type checking
	$(COMPOSE) exec sietch-dev npx tsc --noEmit

# =============================================================================
# Cleanup
# =============================================================================

clean: ## Stop and remove all containers and volumes
	@echo "$(CYAN)Stopping and removing containers...$(RESET)"
	$(COMPOSE) down -v
	@echo "$(GREEN)Cleaned up!$(RESET)"

clean-images: ## Remove development images
	@echo "$(CYAN)Removing development images...$(RESET)"
	docker rmi arrakis-sietch-dev 2>/dev/null || true
	docker rmi arrakis-dev 2>/dev/null || true

# =============================================================================
# Status
# =============================================================================

status: ## Show container status
	$(COMPOSE) ps

logs-postgres: ## Tail PostgreSQL logs
	$(COMPOSE) logs -f postgres

logs-redis: ## Tail Redis logs
	$(COMPOSE) logs -f redis
