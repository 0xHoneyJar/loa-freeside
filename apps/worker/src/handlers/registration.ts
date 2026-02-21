// @ts-nocheck
/**
 * Handler Registration Module
 * Sprint S-6: Worker Migration to NATS
 *
 * Bridges existing command handlers to NATS consumer interface.
 * Registers all command handlers with the central registry.
 */

import type { Logger } from 'pino';
import type { DiscordRestService } from '../services/DiscordRest.js';
import type { DiscordEventPayload, ConsumeResult } from '../types.js';
import { registerCommandHandler, type HandlerFn } from './index.js';

// Import all handler factories
import {
  createStatsHandler,
  createPositionHandler,
  createThresholdHandler,
  createLeaderboardHandler,
  createDirectoryHandler,
  createDirectoryButtonHandler,
  createDirectorySelectHandler,
  createProfileHandler,
  createProfileAutocompleteHandler,
  createBadgesHandler,
  createBadgesAutocompleteHandler,
  createAlertsHandler,
  createAlertsButtonHandler,
  createAlertsSelectHandler,
  createNaibHandler,
  createAdminStatsHandler,
  createAdminBadgeHandler,
  createAdminBadgeAutocompleteHandler,
  createMyAgentHandler,
  createAgentInfoHandler,
} from './commands/index.js';

// --------------------------------------------------------------------------
// Handler Adapter
// --------------------------------------------------------------------------

/**
 * Creates a handler function that wraps the existing handler factories.
 * The factories expect (discord, payload, logger) but the registry expects (payload, logger).
 * This adapter captures the discord service and returns a compatible handler.
 */
function createHandlerAdapter(
  discord: DiscordRestService,
  factoryFn: (discord: DiscordRestService) => (payload: DiscordEventPayload, logger: Logger) => Promise<ConsumeResult>
): HandlerFn {
  const handler = factoryFn(discord);
  return handler;
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------

/**
 * Register all command handlers with the handler registry.
 * Call this once during worker initialization.
 *
 * @param discord - Discord REST service for API calls
 * @returns Map of command names to handler functions
 */
export function registerAllCommandHandlers(
  discord: DiscordRestService
): Map<string, HandlerFn> {
  const registry = new Map<string, HandlerFn>();

  // Core commands
  registry.set('stats', createHandlerAdapter(discord, createStatsHandler));
  registry.set('position', createHandlerAdapter(discord, createPositionHandler));
  registry.set('threshold', createHandlerAdapter(discord, createThresholdHandler));
  registry.set('leaderboard', createHandlerAdapter(discord, createLeaderboardHandler));
  registry.set('naib', createHandlerAdapter(discord, createNaibHandler));

  // Profile commands
  registry.set('profile', createHandlerAdapter(discord, createProfileHandler));

  // Badge commands
  registry.set('badges', createHandlerAdapter(discord, createBadgesHandler));

  // Directory commands
  registry.set('directory', createHandlerAdapter(discord, createDirectoryHandler));

  // Alerts commands
  registry.set('alerts', createHandlerAdapter(discord, createAlertsHandler));

  // Admin commands
  registry.set('admin-stats', createHandlerAdapter(discord, createAdminStatsHandler));
  registry.set('admin-badge', createHandlerAdapter(discord, createAdminBadgeHandler));

  // Agent commands (Sprint 4)
  registry.set('my-agent', createHandlerAdapter(discord, createMyAgentHandler));
  registry.set('agent-info', createHandlerAdapter(discord, createAgentInfoHandler));

  // Also register with global registry for backwards compatibility
  for (const [name, handler] of registry) {
    registerCommandHandler(name, handler);
  }

  return registry;
}

/**
 * Register autocomplete handlers separately.
 * These respond to autocomplete interactions, not command executions.
 */
export function registerAutocompleteHandlers(
  discord: DiscordRestService
): Map<string, HandlerFn> {
  const registry = new Map<string, HandlerFn>();

  registry.set('profile', createHandlerAdapter(discord, createProfileAutocompleteHandler));
  registry.set('badges', createHandlerAdapter(discord, createBadgesAutocompleteHandler));
  registry.set('admin-badge', createHandlerAdapter(discord, createAdminBadgeAutocompleteHandler));

  return registry;
}

/**
 * Register button interaction handlers.
 */
export function registerButtonHandlers(
  discord: DiscordRestService
): Map<string, HandlerFn> {
  const registry = new Map<string, HandlerFn>();

  registry.set('directory', createHandlerAdapter(discord, createDirectoryButtonHandler));
  registry.set('alerts', createHandlerAdapter(discord, createAlertsButtonHandler));

  return registry;
}

/**
 * Register select menu handlers.
 */
export function registerSelectHandlers(
  discord: DiscordRestService
): Map<string, HandlerFn> {
  const registry = new Map<string, HandlerFn>();

  registry.set('directory', createHandlerAdapter(discord, createDirectorySelectHandler));
  registry.set('alerts', createHandlerAdapter(discord, createAlertsSelectHandler));

  return registry;
}

/**
 * Register all handlers (commands, autocomplete, buttons, selects).
 * Returns a combined registry with prefixed keys for routing.
 */
export function registerAllHandlers(
  discord: DiscordRestService
): {
  commands: Map<string, HandlerFn>;
  autocomplete: Map<string, HandlerFn>;
  buttons: Map<string, HandlerFn>;
  selects: Map<string, HandlerFn>;
} {
  return {
    commands: registerAllCommandHandlers(discord),
    autocomplete: registerAutocompleteHandlers(discord),
    buttons: registerButtonHandlers(discord),
    selects: registerSelectHandlers(discord),
  };
}
