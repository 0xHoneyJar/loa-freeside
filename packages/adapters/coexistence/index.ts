/**
 * Coexistence Adapters
 *
 * Sprint S-24: Incumbent Detection & Shadow Ledger
 *
 * Adapters for shadow mode coexistence including:
 * - IncumbentDetector: Auto-detection of Collab.Land, Matrica, Guild.xyz
 * - ScyllaDBShadowLedger: Shadow state and divergence tracking
 *
 * @see SDD §7.1 Shadow Mode Architecture
 */

export {
  IncumbentDetector,
  createIncumbentDetector,
  type IDiscordRestService,
  type GuildMember,
  type GuildChannel,
  type GuildRole,
  type DetectionOptions,
} from './incumbent-detector.js';

export {
  ScyllaDBShadowLedger,
  createScyllaDBShadowLedger,
  type IScyllaClient,
} from './shadow-ledger.js';
