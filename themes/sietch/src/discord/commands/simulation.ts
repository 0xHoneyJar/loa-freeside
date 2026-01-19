/**
 * /simulation Slash Command
 *
 * Sprint 107: Role Assumption - Discord Commands
 * Sprint 108: State Configuration - Discord Commands
 * Sprint 109: Permission Check - Discord Commands
 *
 * QA testing command for assuming roles and checking simulation state
 * within sandbox environments.
 *
 * Usage:
 * - /simulation assume <tier> - Assume a tier role for testing
 * - /simulation whoami - View current simulation state
 * - /simulation set <attribute> <value> - Set a state attribute
 * - /simulation reset - Reset all state to defaults
 * - /simulation check access <channel> - Check channel access
 * - /simulation check feature <id> - Check feature access
 * - /simulation check tier - Check current tier
 * - /simulation check badges - Check badge eligibility
 *
 * Note: This command only works in sandbox-enabled guilds.
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
  type TierId,
  type EngagementStage,
  TIER_ORDER,
  TIER_DISPLAY_NAMES,
  SimulationService,
  SimulationErrorCode,
} from '../../services/sandbox/index.js';

// =============================================================================
// RBAC Configuration (Sprint 112 - HIGH-001 Fix)
// =============================================================================

/**
 * Permission levels for simulation command operations
 */
export enum QAPermissionLevel {
  NONE = 0,
  SELF_ONLY = 1,      // Can manage own context
  QA_TESTER = 2,      // Can manage any context in sandbox
  QA_ADMIN = 3,       // Can modify thresholds and clear any context
}

/**
 * Role name patterns that grant QA permissions
 * These are case-insensitive and support partial matching
 */
const QA_ADMIN_ROLE_PATTERNS = [
  'qa admin',
  'qa-admin',
  'qaadmin',
  'admin',
];

const QA_TESTER_ROLE_PATTERNS = [
  'qa tester',
  'qa-tester',
  'qatester',
  'tester',
  'qa',
];

/**
 * Environment variable to override role patterns
 * Format: "admin_pattern1,admin_pattern2|tester_pattern1,tester_pattern2"
 */
function loadRolePatterns(): { admin: string[]; tester: string[] } {
  const envPatterns = process.env.SIMULATION_QA_ROLES;
  if (!envPatterns) {
    return {
      admin: QA_ADMIN_ROLE_PATTERNS,
      tester: QA_TESTER_ROLE_PATTERNS,
    };
  }

  const [adminStr, testerStr] = envPatterns.split('|');
  return {
    admin: adminStr?.split(',').filter(Boolean) || QA_ADMIN_ROLE_PATTERNS,
    tester: testerStr?.split(',').filter(Boolean) || QA_TESTER_ROLE_PATTERNS,
  };
}

const rolePatterns = loadRolePatterns();

/**
 * Get the QA permission level for a guild member
 *
 * @param member - Discord guild member (or null for DMs)
 * @returns Permission level for the member
 */
export function getQAPermissionLevel(
  member: GuildMember | null | undefined
): QAPermissionLevel {
  if (!member) {
    return QAPermissionLevel.NONE;
  }

  // Server administrators always get full access
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return QAPermissionLevel.QA_ADMIN;
  }

  // Check member roles
  const memberRoleNames = member.roles.cache.map((r) => r.name.toLowerCase());

  // Check for QA Admin roles first (highest privilege)
  const hasAdminRole = rolePatterns.admin.some((pattern) =>
    memberRoleNames.some((roleName) => roleName.includes(pattern.toLowerCase()))
  );
  if (hasAdminRole) {
    return QAPermissionLevel.QA_ADMIN;
  }

  // Check for QA Tester roles
  const hasTesterRole = rolePatterns.tester.some((pattern) =>
    memberRoleNames.some((roleName) => roleName.includes(pattern.toLowerCase()))
  );
  if (hasTesterRole) {
    return QAPermissionLevel.QA_TESTER;
  }

  // Default: can only manage own context
  return QAPermissionLevel.SELF_ONLY;
}

/**
 * Check if a member has permission for a specific operation
 *
 * @param member - Discord guild member
 * @param requiredLevel - Required permission level
 * @param targetUserId - Target user ID (for self-context check)
 * @param callerId - ID of the user invoking the command
 * @returns true if operation is allowed
 */
export function hasPermission(
  member: GuildMember | null | undefined,
  requiredLevel: QAPermissionLevel,
  targetUserId: string | null,
  callerId: string
): boolean {
  const memberLevel = getQAPermissionLevel(member);

  // QA Admin can do everything
  if (memberLevel >= QAPermissionLevel.QA_ADMIN) {
    return true;
  }

  // QA Tester can do anything except admin-level operations
  if (memberLevel >= QAPermissionLevel.QA_TESTER && requiredLevel <= QAPermissionLevel.QA_TESTER) {
    return true;
  }

  // Self-only: can manage own context for self-only level operations
  if (memberLevel >= QAPermissionLevel.SELF_ONLY && requiredLevel <= QAPermissionLevel.SELF_ONLY) {
    // If there's no target user, or target is self, allow
    if (!targetUserId || targetUserId === callerId) {
      return true;
    }
  }

  return false;
}

/**
 * Get a user-friendly error message for permission denial
 */
function getPermissionDenialMessage(
  requiredLevel: QAPermissionLevel,
  isSelfAllowed: boolean
): string {
  switch (requiredLevel) {
    case QAPermissionLevel.QA_ADMIN:
      return '❌ This operation requires QA Admin permissions.';
    case QAPermissionLevel.QA_TESTER:
      if (isSelfAllowed) {
        return '❌ You can only modify your own simulation context. QA Tester role required to modify others.';
      }
      return '❌ This operation requires QA Tester permissions.';
    default:
      return '❌ You do not have permission to perform this operation.';
  }
}

// =============================================================================
// Command Cooldowns (Sprint 112 - HIGH-002 Fix)
// =============================================================================

/**
 * Per-subcommand cooldown durations in milliseconds
 *
 * These prevent rapid-fire abuse of simulation commands.
 * Adjust based on operation cost and abuse potential.
 */
export const COMMAND_COOLDOWNS: Record<string, number> = {
  assume: 5000,      // 5 seconds - prevents rapid tier switching
  whoami: 2000,      // 2 seconds - low cost operation
  set: 3000,         // 3 seconds - state modification
  reset: 10000,      // 10 seconds - destructive operation
  access: 5000,      // 5 seconds - expensive permission check
  feature: 5000,     // 5 seconds - expensive permission check
  tier: 5000,        // 5 seconds - tier calculation
  badges: 5000,      // 5 seconds - badge evaluation
  thresholds: 10000, // 10 seconds - admin-only operation
};

/**
 * Default cooldown for commands not explicitly configured
 */
const DEFAULT_COOLDOWN = 3000;

/**
 * Cooldown tracker: Map<commandKey, Map<userId, lastUseTimestamp>>
 * Key format: "simulation:{subcommand}" or "simulation:check:{subcommand}"
 */
const cooldownTracker = new Map<string, Map<string, number>>();

/**
 * Check if a user is on cooldown for a subcommand
 *
 * @param userId - Discord user ID
 * @param subcommand - The subcommand being executed
 * @param subcommandGroup - Optional subcommand group (e.g., "check")
 * @returns null if not on cooldown, or seconds remaining if on cooldown
 */
export function checkCooldown(
  userId: string,
  subcommand: string,
  subcommandGroup: string | null = null
): number | null {
  // Build cooldown key
  const cooldownKey = subcommandGroup
    ? `simulation:${subcommandGroup}:${subcommand}`
    : `simulation:${subcommand}`;

  // Get cooldown duration for this subcommand
  const cooldownMs = COMMAND_COOLDOWNS[subcommand] ?? DEFAULT_COOLDOWN;

  // Get or create user map for this command
  if (!cooldownTracker.has(cooldownKey)) {
    cooldownTracker.set(cooldownKey, new Map());
  }
  const userCooldowns = cooldownTracker.get(cooldownKey)!;

  // Check if user has existing cooldown
  const lastUse = userCooldowns.get(userId);
  if (lastUse) {
    const expiresAt = lastUse + cooldownMs;
    const now = Date.now();

    if (now < expiresAt) {
      // Still on cooldown - return seconds remaining
      return Math.ceil((expiresAt - now) / 1000);
    }
  }

  // Not on cooldown - record this use
  userCooldowns.set(userId, Date.now());

  // Schedule cleanup
  setTimeout(() => {
    userCooldowns.delete(userId);
  }, cooldownMs);

  return null;
}

/**
 * Clear cooldown for a user (for testing)
 */
export function clearCooldown(userId: string, subcommand: string): void {
  const cooldownKey = `simulation:${subcommand}`;
  const userCooldowns = cooldownTracker.get(cooldownKey);
  if (userCooldowns) {
    userCooldowns.delete(userId);
  }
}

/**
 * Clear all cooldowns (for testing)
 */
export function clearAllCooldowns(): void {
  cooldownTracker.clear();
}

// =============================================================================
// State Attribute Definitions
// =============================================================================

/**
 * Valid state attributes that can be set via /simulation set
 */
const STATE_ATTRIBUTES = {
  bgt: {
    name: 'bgt',
    displayName: 'BGT Balance',
    type: 'number' as const,
    description: 'Set BGT balance (affects tier)',
  },
  rank: {
    name: 'rank',
    displayName: 'Rank',
    type: 'number' as const,
    description: 'Set rank position',
  },
  stage: {
    name: 'stage',
    displayName: 'Engagement Stage',
    type: 'string' as const,
    description: 'Set engagement stage (free/engaged/verified)',
  },
  activity: {
    name: 'activity',
    displayName: 'Activity Score',
    type: 'number' as const,
    description: 'Set activity score',
  },
  tenure: {
    name: 'tenure',
    displayName: 'Tenure (days)',
    type: 'number' as const,
    description: 'Set tenure in days',
  },
  conviction: {
    name: 'conviction',
    displayName: 'Conviction Score',
    type: 'number' as const,
    description: 'Set conviction score',
  },
} as const;

type StateAttributeKey = keyof typeof STATE_ATTRIBUTES;

/**
 * Build attribute choices for the set subcommand
 */
function buildAttributeChoices(): Array<{ name: string; value: string }> {
  return Object.values(STATE_ATTRIBUTES).map((attr) => ({
    name: `${attr.displayName} - ${attr.description}`,
    value: attr.name,
  }));
}

/**
 * Build engagement stage choices
 */
function buildStageChoices(): Array<{ name: string; value: string }> {
  return [
    { name: 'Free', value: 'free' },
    { name: 'Engaged', value: 'engaged' },
    { name: 'Verified', value: 'verified' },
  ];
}

import type { MinimalRedis } from '../../services/sandbox/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Simulation command dependencies
 *
 * These must be injected before the command can be used.
 * Use `initializeSimulationCommand()` to set up dependencies.
 */
interface SimulationDependencies {
  redis: MinimalRedis;
  getSandboxIdForGuild: (guildId: string) => Promise<string | null>;
}

let dependencies: SimulationDependencies | null = null;

/**
 * Initialize simulation command with required dependencies
 *
 * Must be called during bot startup before commands are processed.
 *
 * @param deps - Required dependencies
 */
export function initializeSimulationCommand(deps: SimulationDependencies): void {
  dependencies = deps;
  logger.info('Simulation command initialized');
}

// =============================================================================
// Command Definition
// =============================================================================

/**
 * Build tier choices for the assume subcommand
 */
function buildTierChoices(): Array<{ name: string; value: string }> {
  const choices: Array<{ name: string; value: string }> = TIER_ORDER.map((tierId) => ({
    name: TIER_DISPLAY_NAMES[tierId],
    value: tierId,
  }));

  // Add "reset" option at the end
  choices.push({
    name: '🔄 Reset (use computed tier)',
    value: 'reset',
  });

  return choices;
}

/**
 * Slash command definition
 */
export const simulationCommand = new SlashCommandBuilder()
  .setName('simulation')
  .setDescription('QA testing: Manage simulation state in sandbox')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('assume')
      .setDescription('Assume a tier role for testing')
      .addStringOption((option) =>
        option
          .setName('tier')
          .setDescription('Tier to assume (or "reset" to clear)')
          .setRequired(true)
          .addChoices(...buildTierChoices())
      )
      .addIntegerOption((option) =>
        option
          .setName('rank')
          .setDescription('Optional rank within the tier')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(10000)
      )
      .addStringOption((option) =>
        option
          .setName('note')
          .setDescription('Optional note explaining the test scenario')
          .setRequired(false)
          .setMaxLength(200)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('whoami')
      .setDescription('View current simulation state')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('set')
      .setDescription('Set a state attribute value')
      .addStringOption((option) =>
        option
          .setName('attribute')
          .setDescription('Attribute to set')
          .setRequired(true)
          .addChoices(...buildAttributeChoices())
      )
      .addStringOption((option) =>
        option
          .setName('value')
          .setDescription('Value to set (number or stage name)')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('reset')
      .setDescription('Reset all state to defaults')
  )
  .addSubcommandGroup((group) =>
    group
      .setName('check')
      .setDescription('Check permissions and access')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('access')
          .setDescription('Check channel access')
          .addStringOption((option) =>
            option
              .setName('channel')
              .setDescription('Channel name to check (e.g., council-chamber)')
              .setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('feature')
          .setDescription('Check feature/permission access')
          .addStringOption((option) =>
            option
              .setName('id')
              .setDescription('Feature ID to check (e.g., vote, council_access)')
              .setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName('tier').setDescription('Check current tier status')
      )
      .addSubcommand((subcommand) =>
        subcommand.setName('badges').setDescription('Check badge eligibility')
      )
  );

// =============================================================================
// Command Handler
// =============================================================================

/**
 * Handle /simulation command execution
 *
 * Sprint 112 (HIGH-001): Added RBAC permission checks
 * Sprint 112 (HIGH-002): Added cooldown enforcement
 */
export async function handleSimulationCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  // Validate guild context
  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  // Check dependencies are initialized
  if (!dependencies) {
    logger.error('Simulation command called before initialization');
    await interaction.reply({
      content: 'Simulation system is not initialized. Please contact an administrator.',
      ephemeral: true,
    });
    return;
  }

  // Check cooldown (Sprint 112 - HIGH-002)
  const cooldownRemaining = checkCooldown(userId, subcommand, subcommandGroup);
  if (cooldownRemaining !== null) {
    await interaction.reply({
      content: `⏳ Please wait ${cooldownRemaining} second${cooldownRemaining === 1 ? '' : 's'} before using \`/simulation ${subcommandGroup ? `${subcommandGroup} ` : ''}${subcommand}\` again.`,
      ephemeral: true,
    });
    return;
  }

  // Get member for RBAC checks
  const member = interaction.member as GuildMember | null;

  try {
    // Get sandbox ID for this guild
    const sandboxId = await dependencies.getSandboxIdForGuild(guildId);

    if (!sandboxId) {
      await interaction.reply({
        content:
          '⚠️ This server is not part of a sandbox environment.\n' +
          'The `/simulation` command only works in sandbox-enabled servers.',
        ephemeral: true,
      });
      return;
    }

    // Create service instance
    const service = new SimulationService(dependencies.redis);

    // Handle check subcommand group
    // Check operations are SELF_ONLY - users can check their own simulation state
    if (subcommandGroup === 'check') {
      // All check subcommands use the caller's own context
      if (!hasPermission(member, QAPermissionLevel.SELF_ONLY, userId, userId)) {
        await interaction.reply({
          content: getPermissionDenialMessage(QAPermissionLevel.SELF_ONLY, true),
          ephemeral: true,
        });
        return;
      }

      switch (subcommand) {
        case 'access':
          await handleCheckAccessSubcommand(interaction, service, sandboxId, userId);
          break;
        case 'feature':
          await handleCheckFeatureSubcommand(interaction, service, sandboxId, userId);
          break;
        case 'tier':
          await handleCheckTierSubcommand(interaction, service, sandboxId, userId);
          break;
        case 'badges':
          await handleCheckBadgesSubcommand(interaction, service, sandboxId, userId);
          break;
        default:
          await interaction.reply({
            content: 'Unknown check subcommand.',
            ephemeral: true,
          });
      }
      return;
    }

    // Handle top-level subcommands with RBAC
    switch (subcommand) {
      case 'assume':
        // Assume operates on self - SELF_ONLY level
        if (!hasPermission(member, QAPermissionLevel.SELF_ONLY, userId, userId)) {
          await interaction.reply({
            content: getPermissionDenialMessage(QAPermissionLevel.SELF_ONLY, true),
            ephemeral: true,
          });
          return;
        }
        await handleAssumeSubcommand(interaction, service, sandboxId, userId);
        break;

      case 'whoami':
        // Whoami operates on self - SELF_ONLY level
        if (!hasPermission(member, QAPermissionLevel.SELF_ONLY, userId, userId)) {
          await interaction.reply({
            content: getPermissionDenialMessage(QAPermissionLevel.SELF_ONLY, true),
            ephemeral: true,
          });
          return;
        }
        await handleWhoamiSubcommand(interaction, service, sandboxId, userId);
        break;

      case 'set':
        // Set operates on self - SELF_ONLY level
        if (!hasPermission(member, QAPermissionLevel.SELF_ONLY, userId, userId)) {
          await interaction.reply({
            content: getPermissionDenialMessage(QAPermissionLevel.SELF_ONLY, true),
            ephemeral: true,
          });
          return;
        }
        await handleSetSubcommand(interaction, service, sandboxId, userId);
        break;

      case 'reset':
        // Reset operates on self - SELF_ONLY level
        if (!hasPermission(member, QAPermissionLevel.SELF_ONLY, userId, userId)) {
          await interaction.reply({
            content: getPermissionDenialMessage(QAPermissionLevel.SELF_ONLY, true),
            ephemeral: true,
          });
          return;
        }
        await handleResetSubcommand(interaction, service, sandboxId, userId);
        break;

      default:
        await interaction.reply({
          content: 'Unknown subcommand.',
          ephemeral: true,
        });
    }

    // Log successful command with permission level for audit
    const permissionLevel = getQAPermissionLevel(member);
    logger.debug(
      {
        sandboxId,
        userId,
        subcommand,
        subcommandGroup,
        permissionLevel: QAPermissionLevel[permissionLevel],
      },
      'Simulation command executed with RBAC'
    );
  } catch (error) {
    logger.error({ error, subcommand, userId, guildId }, 'Error handling /simulation command');

    const errorMessage = 'An error occurred while processing the simulation command. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

// =============================================================================
// Subcommand Handlers
// =============================================================================

/**
 * Handle /simulation assume subcommand
 */
async function handleAssumeSubcommand(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string,
  userId: string
): Promise<void> {
  const tierOption = interaction.options.getString('tier', true);
  const rank = interaction.options.getInteger('rank') ?? undefined;
  const note = interaction.options.getString('note') ?? undefined;

  // Handle reset case
  if (tierOption === 'reset') {
    const result = await service.clearRole(sandboxId, userId);

    if (!result.success) {
      // If context doesn't exist, that's fine - nothing to clear
      if (result.error?.code === SimulationErrorCode.NOT_FOUND) {
        await interaction.reply({
          content: '✅ No assumed role to clear. You are using your computed tier.',
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: `❌ Failed to reset role: ${result.error?.message ?? 'Unknown error'}`,
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🔄 Role Reset')
      .setDescription('Your assumed role has been cleared. You are now using your computed tier.')
      .setColor(0x3498db)
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
    return;
  }

  // Assume the specified tier
  const tierId = tierOption as TierId;
  const result = await service.assumeRole(sandboxId, userId, tierId, { rank, note });

  if (!result.success) {
    await interaction.reply({
      content: `❌ Failed to assume role: ${result.error?.message ?? 'Unknown error'}`,
      ephemeral: true,
    });
    return;
  }

  const context = result.data!;
  const assumedRole = context.assumedRole!;

  // Build success embed
  const embed = new EmbedBuilder()
    .setTitle('🎭 Role Assumed')
    .setDescription(`You are now simulating the **${TIER_DISPLAY_NAMES[tierId]}** tier.`)
    .setColor(getTierColor(tierId))
    .addFields(
      { name: 'Tier', value: TIER_DISPLAY_NAMES[tierId], inline: true },
      { name: 'Rank', value: String(assumedRole.rank), inline: true },
      { name: 'Assumed At', value: `<t:${Math.floor(new Date(assumedRole.assumedAt).getTime() / 1000)}:R>`, inline: true }
    )
    .setTimestamp();

  if (note) {
    embed.addFields({ name: 'Test Note', value: note });
  }

  if (assumedRole.badges.length > 0) {
    embed.addFields({ name: 'Badges', value: assumedRole.badges.join(', ') });
  }

  embed.setFooter({
    text: 'Use /simulation whoami to see full state • /simulation assume reset to clear',
  });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.debug(
    { sandboxId, userId, tierId, rank },
    'Role assumed via /simulation command'
  );
}

/**
 * Handle /simulation whoami subcommand
 */
async function handleWhoamiSubcommand(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string,
  userId: string
): Promise<void> {
  const result = await service.whoami(sandboxId, userId);

  if (!result.success) {
    await interaction.reply({
      content: `❌ Failed to get simulation state: ${result.error?.message ?? 'Unknown error'}`,
      ephemeral: true,
    });
    return;
  }

  const whoami = result.data!;

  // Build state embed
  const embed = new EmbedBuilder()
    .setTitle('📊 Simulation State')
    .setColor(getTierColor(whoami.effectiveTier.tierId))
    .setTimestamp();

  // Effective tier (most important)
  const sourceIcon = whoami.effectiveTier.source === 'assumed' ? '🎭' : '📈';
  embed.addFields({
    name: 'Effective Tier',
    value: `${sourceIcon} **${whoami.effectiveTier.displayName}** (${whoami.effectiveTier.source})`,
    inline: false,
  });

  // Show assumed role if present
  if (whoami.assumedRole) {
    embed.addFields(
      { name: 'Assumed Tier', value: TIER_DISPLAY_NAMES[whoami.assumedRole.tierId], inline: true },
      { name: 'Assumed Rank', value: String(whoami.assumedRole.rank), inline: true },
      {
        name: 'Assumed Since',
        value: `<t:${Math.floor(new Date(whoami.assumedRole.assumedAt).getTime() / 1000)}:R>`,
        inline: true,
      }
    );

    if (whoami.assumedRole.note) {
      embed.addFields({ name: 'Test Note', value: whoami.assumedRole.note });
    }

    if (whoami.assumedRole.badges.length > 0) {
      embed.addFields({ name: 'Assumed Badges', value: whoami.assumedRole.badges.join(', ') });
    }
  }

  // Member state section
  const state = whoami.memberState;
  embed.addFields(
    { name: '💰 BGT Balance', value: String(state.bgtBalance), inline: true },
    { name: '🏆 Rank', value: String(whoami.effectiveTier.rank), inline: true },
    { name: '📊 Engagement', value: `${state.engagementStage} (${state.engagementPoints} pts)`, inline: true }
  );

  // Show computed tier for comparison when assuming
  if (whoami.assumedRole) {
    embed.addFields({
      name: 'Computed Tier (without assumption)',
      value: `${whoami.computedTier.displayName} (rank ${whoami.computedTier.rank})`,
      inline: false,
    });
  }

  // Additional state info
  embed.addFields(
    { name: '⚡ Activity Score', value: String(state.activityScore), inline: true },
    { name: '💪 Conviction Score', value: String(state.convictionScore), inline: true },
    { name: '📅 Tenure (days)', value: String(state.tenureDays), inline: true }
  );

  // Threshold overrides indicator
  if (whoami.thresholdOverrides && Object.keys(whoami.thresholdOverrides).length > 0) {
    const overrideList = Object.entries(whoami.thresholdOverrides)
      .map(([tier, value]) => `${tier}: ${value}`)
      .join(', ');
    embed.addFields({ name: '⚙️ Threshold Overrides', value: overrideList });
  }

  embed.setFooter({
    text: `Sandbox: ${sandboxId.slice(0, 8)}... • Context v${whoami.contextVersion}`,
  });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.debug(
    { sandboxId, userId, effectiveTier: whoami.effectiveTier.tierId },
    'Whoami viewed via /simulation command'
  );
}

/**
 * Handle /simulation set subcommand
 */
async function handleSetSubcommand(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string,
  userId: string
): Promise<void> {
  const attribute = interaction.options.getString('attribute', true) as StateAttributeKey;
  const valueString = interaction.options.getString('value', true);

  // Validate attribute exists
  const attrConfig = STATE_ATTRIBUTES[attribute];
  if (!attrConfig) {
    await interaction.reply({
      content: `❌ Unknown attribute: ${attribute}`,
      ephemeral: true,
    });
    return;
  }

  // Parse and validate value based on attribute type
  let updates: Record<string, number | string>;

  if (attribute === 'stage') {
    // Validate engagement stage
    const validStages = ['free', 'engaged', 'verified'];
    if (!validStages.includes(valueString.toLowerCase())) {
      await interaction.reply({
        content: `❌ Invalid stage value: "${valueString}"\nValid options: ${validStages.join(', ')}`,
        ephemeral: true,
      });
      return;
    }
    updates = { engagementStage: valueString.toLowerCase() as EngagementStage };
  } else {
    // Parse numeric value
    const numValue = parseFloat(valueString);
    if (isNaN(numValue)) {
      await interaction.reply({
        content: `❌ "${attrConfig.displayName}" requires a numeric value. Got: "${valueString}"`,
        ephemeral: true,
      });
      return;
    }

    // Map attribute names to SimulatedMemberState field names
    const fieldMap: Record<string, string> = {
      bgt: 'bgtBalance',
      rank: 'rank',
      activity: 'activityScore',
      tenure: 'tenureDays',
      conviction: 'convictionScore',
    };

    const fieldName = fieldMap[attribute];
    if (!fieldName) {
      await interaction.reply({
        content: `❌ Unknown field mapping for: ${attribute}`,
        ephemeral: true,
      });
      return;
    }

    updates = { [fieldName]: numValue };
  }

  // Call setState service method
  const result = await service.setState(sandboxId, userId, updates);

  if (!result.success) {
    await interaction.reply({
      content: `❌ Failed to set ${attrConfig.displayName}: ${result.error?.message ?? 'Unknown error'}`,
      ephemeral: true,
    });
    return;
  }

  const stateResult = result.data!;

  // Build success embed
  const embed = new EmbedBuilder()
    .setTitle('⚙️ State Updated')
    .setColor(getTierColor(stateResult.computedTier.tierId))
    .addFields(
      { name: 'Updated Field', value: attrConfig.displayName, inline: true },
      { name: 'New Value', value: valueString, inline: true },
      { name: 'Computed Tier', value: stateResult.computedTier.displayName, inline: true }
    )
    .setTimestamp();

  // Show all updated state values
  const state = stateResult.newState;
  embed.addFields(
    { name: '💰 BGT Balance', value: String(state.bgtBalance), inline: true },
    { name: '🏆 Computed Rank', value: String(stateResult.computedTier.rank), inline: true },
    { name: '📊 Engagement', value: `${state.engagementStage} (${state.engagementPoints} pts)`, inline: true }
  );

  embed.setFooter({
    text: `Use /simulation whoami to see full state • Context v${stateResult.contextVersion}`,
  });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.debug(
    { sandboxId, userId, attribute, value: valueString, computedTier: stateResult.computedTier.tierId },
    'State set via /simulation command'
  );
}

/**
 * Handle /simulation reset subcommand
 */
async function handleResetSubcommand(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string,
  userId: string
): Promise<void> {
  // Delete the context entirely - this resets all state
  const result = await service.deleteContext(sandboxId, userId);

  if (!result.success) {
    await interaction.reply({
      content: `❌ Failed to reset state: ${result.error?.message ?? 'Unknown error'}`,
      ephemeral: true,
    });
    return;
  }

  // Build success embed
  const embed = new EmbedBuilder()
    .setTitle('🔄 State Reset')
    .setDescription('All simulation state has been reset to defaults.')
    .setColor(0x3498db)
    .addFields(
      { name: '💰 BGT Balance', value: '0', inline: true },
      { name: '🏆 Rank', value: '1000', inline: true },
      { name: '📊 Engagement', value: 'free (0 pts)', inline: true }
    )
    .setTimestamp();

  embed.setFooter({
    text: 'Use /simulation set to configure new state',
  });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.info(
    { sandboxId, userId },
    'State reset via /simulation command'
  );
}

/**
 * Handle /simulation check access subcommand
 */
async function handleCheckAccessSubcommand(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string,
  userId: string
): Promise<void> {
  const channelName = interaction.options.getString('channel', true);

  const result = await service.checkChannelAccess(sandboxId, userId, channelName);

  if (!result.success) {
    await interaction.reply({
      content: `❌ Failed to check access: ${result.error?.message ?? 'Unknown error'}`,
      ephemeral: true,
    });
    return;
  }

  const check = result.data!;

  const embed = new EmbedBuilder()
    .setTitle(`🔐 Channel Access: ${channelName}`)
    .setColor(check.allowed ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      { name: 'Access', value: check.allowed ? '✅ Granted' : '❌ Denied', inline: true },
      { name: 'Your Tier', value: TIER_DISPLAY_NAMES[check.effectiveTier], inline: true },
      { name: 'Required Tier', value: check.requiredTier ? TIER_DISPLAY_NAMES[check.requiredTier] : 'None', inline: true }
    )
    .addFields(
      { name: 'Blur Level', value: check.blurLevel, inline: true },
      { name: 'Reason', value: check.reason }
    )
    .setTimestamp();

  if (check.permissions.length > 0) {
    embed.addFields({
      name: 'Your Permissions',
      value: check.permissions.join(', '),
    });
  }

  embed.setFooter({ text: 'Use /simulation assume <tier> to test different tiers' });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.debug(
    { sandboxId, userId, channelName, allowed: check.allowed },
    'Channel access checked via /simulation command'
  );
}

/**
 * Handle /simulation check feature subcommand
 */
async function handleCheckFeatureSubcommand(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string,
  userId: string
): Promise<void> {
  const featureId = interaction.options.getString('id', true);

  const result = await service.checkFeatureAccess(sandboxId, userId, featureId);

  if (!result.success) {
    await interaction.reply({
      content: `❌ Failed to check feature: ${result.error?.message ?? 'Unknown error'}`,
      ephemeral: true,
    });
    return;
  }

  const check = result.data!;

  const embed = new EmbedBuilder()
    .setTitle(`⚙️ Feature Access: ${featureId}`)
    .setColor(check.allowed ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      { name: 'Access', value: check.allowed ? '✅ Available' : '❌ Not Available', inline: true },
      { name: 'Your Tier', value: TIER_DISPLAY_NAMES[check.effectiveTier], inline: true },
      { name: 'Required Tier', value: check.requiredTier ? TIER_DISPLAY_NAMES[check.requiredTier] : 'N/A', inline: true }
    )
    .addFields(
      { name: 'Blur Level', value: check.blurLevel, inline: true },
      { name: 'Reason', value: check.reason }
    )
    .setTimestamp();

  embed.setFooter({ text: 'Use /simulation set bgt <amount> to test different BGT levels' });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.debug(
    { sandboxId, userId, featureId, allowed: check.allowed },
    'Feature access checked via /simulation command'
  );
}

/**
 * Handle /simulation check tier subcommand
 */
async function handleCheckTierSubcommand(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string,
  userId: string
): Promise<void> {
  const result = await service.checkTier(sandboxId, userId);

  if (!result.success) {
    await interaction.reply({
      content: `❌ Failed to check tier: ${result.error?.message ?? 'Unknown error'}`,
      ephemeral: true,
    });
    return;
  }

  const tier = result.data!;

  const embed = new EmbedBuilder()
    .setTitle('🎖️ Tier Status')
    .setColor(parseInt(tier.roleColor.replace('#', ''), 16))
    .addFields(
      { name: 'Current Tier', value: tier.tierName, inline: true },
      { name: 'Source', value: tier.source === 'assumed' ? '🎭 Assumed' : '📈 Computed', inline: true },
      { name: 'Rank in Tier', value: String(tier.rankInTier), inline: true }
    )
    .addFields(
      { name: 'BGT Balance', value: String(tier.computedFrom.bgtBalance), inline: true },
      { name: 'Threshold Used', value: tier.computedFrom.thresholdUsed, inline: true }
    )
    .setTimestamp();

  embed.setFooter({ text: 'Use /simulation assume <tier> to test a different tier' });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.debug(
    { sandboxId, userId, tierId: tier.tierId, source: tier.source },
    'Tier checked via /simulation command'
  );
}

/**
 * Handle /simulation check badges subcommand
 */
async function handleCheckBadgesSubcommand(
  interaction: ChatInputCommandInteraction,
  service: SimulationService,
  sandboxId: string,
  userId: string
): Promise<void> {
  const result = await service.checkBadges(sandboxId, userId);

  if (!result.success) {
    await interaction.reply({
      content: `❌ Failed to check badges: ${result.error?.message ?? 'Unknown error'}`,
      ephemeral: true,
    });
    return;
  }

  const badges = result.data!;

  const eligible = badges.filter((b) => b.eligible);
  const ineligible = badges.filter((b) => !b.eligible);

  const embed = new EmbedBuilder()
    .setTitle('🏅 Badge Eligibility')
    .setColor(0x3498db)
    .setDescription(
      `**Eligible:** ${eligible.length} badges\n**Not Eligible:** ${ineligible.length} badges`
    )
    .setTimestamp();

  // Group badges by category
  const categories = ['tenure', 'achievement', 'activity', 'special'];
  for (const category of categories) {
    const categoryBadges = badges.filter((b) => b.category === category);
    if (categoryBadges.length > 0) {
      const badgeList = categoryBadges
        .map((b) => {
          const icon = b.eligible ? '✅' : '❌';
          return `${icon} **${b.displayName}**\n  └ ${b.reason}`;
        })
        .join('\n');

      embed.addFields({
        name: `${category.charAt(0).toUpperCase() + category.slice(1)} Badges`,
        value: badgeList,
      });
    }
  }

  embed.setFooter({
    text: 'Use /simulation set to modify tenure, activity, or conviction scores',
  });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.debug(
    { sandboxId, userId, eligibleCount: eligible.length, totalBadges: badges.length },
    'Badges checked via /simulation command'
  );
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get embed color for a tier
 */
function getTierColor(tierId: TierId): number {
  const tierColors: Record<TierId, number> = {
    naib: 0xffd700,      // Gold
    fedaykin: 0x9b59b6,  // Purple
    usul: 0xe74c3c,      // Red
    sayyadina: 0x3498db, // Blue
    mushtamal: 0x2ecc71, // Green
    sihaya: 0x1abc9c,    // Teal
    qanat: 0xf39c12,     // Orange
    ichwan: 0x95a5a6,    // Gray
    hajra: 0x7f8c8d,     // Dark Gray
  };

  return tierColors[tierId] ?? 0x95a5a6;
}
