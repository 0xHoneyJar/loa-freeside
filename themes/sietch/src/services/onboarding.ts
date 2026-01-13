import {
  User,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
  type ButtonInteraction,
} from 'discord.js';
import { profileService } from './profile.js';
import { avatarService } from './avatar.js';
import { logger } from '../utils/logger.js';
import {
  buildWelcomeEmbed,
  buildPfpSelectionEmbed,
  buildBioPromptEmbed,
  buildOnboardingCompleteEmbed,
  buildEditWizardEmbed,
} from '../discord/embeds/profile.js';
import type { MemberProfile, OnboardingState } from '../types/index.js';

/**
 * Button custom IDs for onboarding flow
 */
export const ONBOARDING_BUTTONS = {
  START: 'onboarding_start',
  NYM_SUBMIT: 'onboarding_nym_submit',
  PFP_UPLOAD: 'onboarding_pfp_upload',
  PFP_GENERATE: 'onboarding_pfp_generate',
  PFP_SKIP: 'onboarding_pfp_skip',
  BIO_ADD: 'onboarding_bio_add',
  BIO_SKIP: 'onboarding_bio_skip',
  EDIT_NYM: 'edit_nym',
  EDIT_PFP: 'edit_pfp',
  EDIT_BIO: 'edit_bio',
  EDIT_CANCEL: 'edit_cancel',
} as const;

/**
 * Modal custom IDs
 */
export const ONBOARDING_MODALS = {
  NYM_INPUT: 'modal_nym_input',
  BIO_INPUT: 'modal_bio_input',
  PFP_URL_INPUT: 'modal_pfp_url_input',
} as const;

/**
 * Onboarding session timeout (15 minutes)
 */
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Onboarding Service
 *
 * Manages the DM-based onboarding wizard for new members.
 * Handles:
 * - Welcome message with privacy assurances
 * - Nym selection with validation
 * - PFP selection (upload, generate, skip)
 * - Bio input (optional)
 * - Profile creation and role assignment
 */
class OnboardingService {
  /**
   * Active onboarding sessions (in-memory)
   * Key: Discord user ID
   */
  private sessions: Map<string, OnboardingState> = new Map();

  /**
   * Start onboarding for a new member
   */
  async startOnboarding(user: User, _tier: 'naib' | 'fedaykin'): Promise<void> {
    const discordUserId = user.id;

    // Check if already has profile
    const existingProfile = profileService.getProfileByDiscordId(discordUserId);
    if (existingProfile) {
      logger.debug({ discordUserId }, 'User already has profile, skipping onboarding');
      return;
    }

    // Initialize session
    const session: OnboardingState = {
      discordUserId,
      currentStep: 0,
      nym: null,
      bio: null,
      pfpUrl: null,
      pfpType: 'none',
      startedAt: new Date(),
      lastInteractionAt: new Date(),
    };

    this.sessions.set(discordUserId, session);

    try {
      // Send welcome DM
      const welcomeEmbed = buildWelcomeEmbed();
      const startButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(ONBOARDING_BUTTONS.START)
          .setLabel('Choose Your Nym')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('✨')
      );

      await user.send({
        embeds: [welcomeEmbed],
        components: [startButton],
      });

      logger.info({ discordUserId }, 'Started onboarding wizard');
    } catch (error) {
      this.sessions.delete(discordUserId);
      logger.error({ error, discordUserId }, 'Failed to start onboarding - DMs may be disabled');
      throw error;
    }
  }

  /**
   * Start edit wizard for existing profile
   */
  async startEditWizard(user: User, profile: MemberProfile): Promise<void> {
    const discordUserId = user.id;

    // Create edit session
    const session: OnboardingState = {
      discordUserId,
      currentStep: -1, // -1 indicates edit mode
      nym: profile.nym,
      bio: profile.bio,
      pfpUrl: profile.pfpUrl,
      pfpType: profile.pfpType,
      startedAt: new Date(),
      lastInteractionAt: new Date(),
    };

    this.sessions.set(discordUserId, session);

    try {
      const editEmbed = buildEditWizardEmbed(profile);
      const editButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(ONBOARDING_BUTTONS.EDIT_NYM)
          .setLabel('Change Nym')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('✏️'),
        new ButtonBuilder()
          .setCustomId(ONBOARDING_BUTTONS.EDIT_PFP)
          .setLabel('Change PFP')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🖼️'),
        new ButtonBuilder()
          .setCustomId(ONBOARDING_BUTTONS.EDIT_BIO)
          .setLabel('Change Bio')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📝'),
        new ButtonBuilder()
          .setCustomId(ONBOARDING_BUTTONS.EDIT_CANCEL)
          .setLabel('Done')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅')
      );

      await user.send({
        embeds: [editEmbed],
        components: [editButtons],
      });

      logger.info({ discordUserId }, 'Started edit wizard');
    } catch (error) {
      this.sessions.delete(discordUserId);
      throw error;
    }
  }

  /**
   * Get active session for a user
   */
  getSession(discordUserId: string): OnboardingState | undefined {
    const session = this.sessions.get(discordUserId);

    if (session) {
      // Check if session has expired
      const elapsed = Date.now() - session.lastInteractionAt.getTime();
      if (elapsed > SESSION_TIMEOUT_MS) {
        this.sessions.delete(discordUserId);
        return undefined;
      }

      // Update last interaction
      session.lastInteractionAt = new Date();
    }

    return session;
  }

  /**
   * Handle start button click
   */
  async handleStartButton(interaction: ButtonInteraction): Promise<void> {
    const session = this.getSession(interaction.user.id);
    if (!session) {
      await interaction.reply({
        content: 'Your session has expired. Please request to start onboarding again.',
        ephemeral: true,
      });
      return;
    }

    // Show nym input modal
    const modal = new ModalBuilder()
      .setCustomId(ONBOARDING_MODALS.NYM_INPUT)
      .setTitle('Choose Your Nym');

    const nymInput = new TextInputBuilder()
      .setCustomId('nym')
      .setLabel('Your Nym (3-20 characters)')
      .setPlaceholder('Enter your pseudonymous name')
      .setStyle(TextInputStyle.Short)
      .setMinLength(3)
      .setMaxLength(20)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nymInput)
    );

    await interaction.showModal(modal);
  }

  /**
   * Handle nym modal submission
   */
  async handleNymSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const session = this.getSession(interaction.user.id);
    if (!session) {
      await interaction.reply({
        content: 'Your session has expired. Please request to start onboarding again.',
        ephemeral: true,
      });
      return;
    }

    const nym = interaction.fields.getTextInputValue('nym').trim();

    // Validate nym
    const validation = profileService.validateNym(nym);
    if (!validation.valid) {
      await interaction.reply({
        content: `❌ ${validation.error}\n\nPlease try again with a different nym.`,
        ephemeral: true,
      });
      return;
    }

    // Check availability
    const isAvailable = await this.isNymAvailable(nym);
    if (!isAvailable) {
      await interaction.reply({
        content: '❌ This nym is already taken. Please choose another.',
        ephemeral: true,
      });
      return;
    }

    // Save nym to session
    session.nym = nym;
    session.currentStep = 1;

    // Show PFP selection
    const pfpEmbed = buildPfpSelectionEmbed(nym);
    const pfpButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ONBOARDING_BUTTONS.PFP_UPLOAD)
        .setLabel('Upload Image')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📸'),
      new ButtonBuilder()
        .setCustomId(ONBOARDING_BUTTONS.PFP_GENERATE)
        .setLabel('Generate Avatar')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🎨'),
      new ButtonBuilder()
        .setCustomId(ONBOARDING_BUTTONS.PFP_SKIP)
        .setLabel('Skip')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️')
    );

    await interaction.reply({
      embeds: [pfpEmbed],
      components: [pfpButtons],
    });
  }

  /**
   * Handle PFP selection buttons
   */
  async handlePfpButton(interaction: ButtonInteraction): Promise<void> {
    const session = this.getSession(interaction.user.id);
    if (!session || !session.nym) {
      await interaction.reply({
        content: 'Your session has expired. Please request to start onboarding again.',
        ephemeral: true,
      });
      return;
    }

    const buttonId = interaction.customId;

    if (buttonId === ONBOARDING_BUTTONS.PFP_UPLOAD) {
      // Show URL input modal for now (Discord doesn't support file uploads in modals)
      const modal = new ModalBuilder()
        .setCustomId(ONBOARDING_MODALS.PFP_URL_INPUT)
        .setTitle('Upload Profile Picture');

      const urlInput = new TextInputBuilder()
        .setCustomId('pfp_url')
        .setLabel('Image URL (Discord CDN or Imgur)')
        .setPlaceholder('https://cdn.discordapp.com/...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (buttonId === ONBOARDING_BUTTONS.PFP_GENERATE) {
      // Generate a temporary avatar (will be finalized on profile creation)
      session.pfpType = 'generated';
      session.currentStep = 2;

      await interaction.update({
        content: '🎨 A unique avatar will be generated for your profile!',
        embeds: [],
        components: [],
      });

      // Proceed to bio step
      await this.showBioStep(interaction.user, session);
      return;
    }

    if (buttonId === ONBOARDING_BUTTONS.PFP_SKIP) {
      session.pfpType = 'none';
      session.currentStep = 2;

      await interaction.update({
        content: '⏭️ No profile picture for now. You can add one later.',
        embeds: [],
        components: [],
      });

      // Proceed to bio step
      await this.showBioStep(interaction.user, session);
      return;
    }
  }

  /**
   * Handle PFP URL modal submission
   */
  async handlePfpUrlSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const session = this.getSession(interaction.user.id);
    if (!session || !session.nym) {
      await interaction.reply({
        content: 'Your session has expired. Please request to start onboarding again.',
        ephemeral: true,
      });
      return;
    }

    const pfpUrl = interaction.fields.getTextInputValue('pfp_url').trim();

    // Validate URL is from trusted domains
    const trustedDomains = ['cdn.discordapp.com', 'media.discordapp.net', 'i.imgur.com'];
    let isValid = false;

    try {
      const url = new URL(pfpUrl);
      isValid = trustedDomains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain));
    } catch {
      isValid = false;
    }

    if (!isValid) {
      await interaction.reply({
        content:
          '❌ Please use an image from Discord CDN or Imgur.\n' +
          'You can upload an image to Discord first, then right-click and "Copy Link".',
        ephemeral: true,
      });
      return;
    }

    session.pfpUrl = pfpUrl;
    session.pfpType = 'custom';
    session.currentStep = 2;

    await interaction.reply({
      content: '✅ Profile picture saved!',
      ephemeral: true,
    });

    // Proceed to bio step
    await this.showBioStep(interaction.user, session);
  }

  /**
   * Show bio prompt step
   */
  private async showBioStep(user: User, session: OnboardingState): Promise<void> {
    const bioEmbed = buildBioPromptEmbed(session.nym!);
    const bioButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ONBOARDING_BUTTONS.BIO_ADD)
        .setLabel('Add Bio')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝'),
      new ButtonBuilder()
        .setCustomId(ONBOARDING_BUTTONS.BIO_SKIP)
        .setLabel('Skip')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️')
    );

    await user.send({
      embeds: [bioEmbed],
      components: [bioButtons],
    });
  }

  /**
   * Handle bio buttons
   */
  async handleBioButton(interaction: ButtonInteraction): Promise<void> {
    const session = this.getSession(interaction.user.id);
    if (!session || !session.nym) {
      await interaction.reply({
        content: 'Your session has expired. Please request to start onboarding again.',
        ephemeral: true,
      });
      return;
    }

    const buttonId = interaction.customId;

    if (buttonId === ONBOARDING_BUTTONS.BIO_ADD) {
      const modal = new ModalBuilder()
        .setCustomId(ONBOARDING_MODALS.BIO_INPUT)
        .setTitle('Add Your Bio');

      const bioInput = new TextInputBuilder()
        .setCustomId('bio')
        .setLabel('Bio (max 160 characters)')
        .setPlaceholder('Tell us about yourself...')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(160)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(bioInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (buttonId === ONBOARDING_BUTTONS.BIO_SKIP) {
      session.bio = null;
      session.currentStep = 3;

      await interaction.update({
        content: '⏭️ No bio for now. You can add one later.',
        embeds: [],
        components: [],
      });

      // Complete onboarding
      await this.completeOnboarding(interaction.user, session);
      return;
    }
  }

  /**
   * Handle bio modal submission
   */
  async handleBioSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const session = this.getSession(interaction.user.id);
    if (!session || !session.nym) {
      await interaction.reply({
        content: 'Your session has expired. Please request to start onboarding again.',
        ephemeral: true,
      });
      return;
    }

    const bio = interaction.fields.getTextInputValue('bio').trim();
    session.bio = bio;
    session.currentStep = 3;

    await interaction.reply({
      content: '✅ Bio saved!',
      ephemeral: true,
    });

    // Complete onboarding
    await this.completeOnboarding(interaction.user, session);
  }

  /**
   * Complete onboarding and create profile
   */
  private async completeOnboarding(user: User, session: OnboardingState): Promise<void> {
    const discordUserId = user.id;

    // Create profile
    const result = await profileService.createProfile(discordUserId, session.nym!, {
      bio: session.bio ?? undefined,
      pfpUrl: session.pfpUrl ?? undefined,
      pfpType: session.pfpType,
    });

    if (result.error) {
      await user.send({
        content: `❌ Failed to create profile: ${result.error}\n\nPlease try again or contact support.`,
      });
      return;
    }

    const profile = result.profile!;

    // Generate avatar if requested
    if (session.pfpType === 'generated') {
      try {
        const avatarDataUrl = avatarService.getAvatarForMember(profile.memberId, profile.tier, 'dataUrl');
        // Note: In production, you'd upload this to Discord CDN and update the profile
        // For now, we store the data URL directly
        await profileService.updateProfile(profile.memberId, { pfpUrl: avatarDataUrl }, discordUserId);
      } catch (error) {
        logger.error({ error }, 'Failed to generate avatar');
      }
    }

    // Complete onboarding
    profileService.completeOnboarding(profile.memberId);

    // Evaluate for Naib seat (Sprint 11)
    let becameNaib = false;
    try {
      const { naibService } = await import('./naib.js');
      const naibResult = naibService.evaluateNewMember(profile.memberId);

      if (naibResult.becameNaib) {
        becameNaib = true;
        logger.info(
          {
            memberId: profile.memberId,
            nym: session.nym,
            seatNumber: naibResult.seatNumber,
            causedBump: naibResult.causedBump,
          },
          'New member became Naib during onboarding'
        );

        // Handle bump notification if someone was displaced
        if (naibResult.causedBump && naibResult.bumpResult?.bumpedMember) {
          const bumpedMember = naibResult.bumpResult.bumpedMember;
          logger.info(
            {
              bumpedMemberId: bumpedMember.profile.memberId,
              bumpedNym: bumpedMember.profile.nym,
              newNaibNym: session.nym,
            },
            'Naib member was bumped by new member'
          );
        }
      }
    } catch (error) {
      logger.error({ error, memberId: profile.memberId }, 'Failed to evaluate Naib seat during onboarding');
    }

    // Assign roles based on Naib status (async, don't wait)
    import('./roleManager.js').then(async ({
      assignOnboardedRole,
      syncMemberRoles,
      assignNaibRole,
    }) => {
      await assignOnboardedRole(discordUserId);

      // If they became Naib, assign Naib role instead of letting syncMemberRoles handle it
      if (becameNaib) {
        await assignNaibRole(discordUserId);
      }

      await syncMemberRoles(profile.memberId);
    }).catch((error) => {
      logger.error({ error, discordUserId }, 'Failed to assign roles after onboarding');
    });

    // Clean up session
    this.sessions.delete(discordUserId);

    // Send completion message (enhanced for Naib)
    const completeEmbed = buildOnboardingCompleteEmbed(session.nym!, profile.tier, becameNaib);
    await user.send({ embeds: [completeEmbed] });

    logger.info(
      { discordUserId, memberId: profile.memberId, nym: session.nym, becameNaib },
      'Onboarding completed'
    );
  }

  /**
   * Handle edit buttons
   */
  async handleEditButton(interaction: ButtonInteraction): Promise<void> {
    const session = this.getSession(interaction.user.id);
    const profile = profileService.getProfileByDiscordId(interaction.user.id);

    if (!session || !profile) {
      await interaction.reply({
        content: 'Your session has expired.',
        ephemeral: true,
      });
      return;
    }

    const buttonId = interaction.customId;

    if (buttonId === ONBOARDING_BUTTONS.EDIT_CANCEL) {
      this.sessions.delete(interaction.user.id);
      await interaction.update({
        content: '✅ Done editing your profile!',
        embeds: [],
        components: [],
      });
      return;
    }

    if (buttonId === ONBOARDING_BUTTONS.EDIT_NYM) {
      // Check cooldown
      const cooldownCheck = profileService.canChangeNym(profile);
      if (!cooldownCheck.canChange) {
        const daysRemaining = Math.ceil(
          (cooldownCheck.cooldownEnds!.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
        );
        await interaction.reply({
          content: `❌ You can change your nym in ${daysRemaining} days.`,
          ephemeral: true,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(ONBOARDING_MODALS.NYM_INPUT)
        .setTitle('Change Your Nym');

      const nymInput = new TextInputBuilder()
        .setCustomId('nym')
        .setLabel('New Nym (3-20 characters)')
        .setPlaceholder(profile.nym)
        .setStyle(TextInputStyle.Short)
        .setMinLength(3)
        .setMaxLength(20)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(nymInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (buttonId === ONBOARDING_BUTTONS.EDIT_PFP) {
      const pfpButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(ONBOARDING_BUTTONS.PFP_UPLOAD)
          .setLabel('Upload New')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📸'),
        new ButtonBuilder()
          .setCustomId(ONBOARDING_BUTTONS.PFP_GENERATE)
          .setLabel('Regenerate')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🎨'),
        new ButtonBuilder()
          .setCustomId(ONBOARDING_BUTTONS.EDIT_CANCEL)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        content: 'How would you like to update your profile picture?',
        embeds: [],
        components: [pfpButtons],
      });
      return;
    }

    if (buttonId === ONBOARDING_BUTTONS.EDIT_BIO) {
      const modal = new ModalBuilder()
        .setCustomId(ONBOARDING_MODALS.BIO_INPUT)
        .setTitle('Edit Your Bio');

      const bioInput = new TextInputBuilder()
        .setCustomId('bio')
        .setLabel('Bio (max 160 characters)')
        .setPlaceholder(profile.bio ?? 'Tell us about yourself...')
        .setValue(profile.bio ?? '')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(160)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(bioInput)
      );

      await interaction.showModal(modal);
      return;
    }
  }

  /**
   * Handle edit nym submission
   */
  async handleEditNymSubmit(
    interaction: ModalSubmitInteraction,
    profile: MemberProfile
  ): Promise<void> {
    const nym = interaction.fields.getTextInputValue('nym').trim();

    // Validate
    const validation = profileService.validateNym(nym);
    if (!validation.valid) {
      await interaction.reply({
        content: `❌ ${validation.error}`,
        ephemeral: true,
      });
      return;
    }

    // Check availability (excluding current profile)
    const existingProfile = profileService.getProfileByNym(nym);
    if (existingProfile && existingProfile.memberId !== profile.memberId) {
      await interaction.reply({
        content: '❌ This nym is already taken.',
        ephemeral: true,
      });
      return;
    }

    // Update profile
    const result = await profileService.updateProfile(
      profile.memberId,
      { nym },
      interaction.user.id
    );

    if (result.error) {
      await interaction.reply({
        content: `❌ ${result.error}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `✅ Your nym has been changed to **${nym}**!`,
      ephemeral: true,
    });
  }

  /**
   * Handle edit bio submission
   */
  async handleEditBioSubmit(
    interaction: ModalSubmitInteraction,
    profile: MemberProfile
  ): Promise<void> {
    const bio = interaction.fields.getTextInputValue('bio').trim() || null;

    const result = await profileService.updateProfile(
      profile.memberId,
      { bio },
      interaction.user.id
    );

    if (result.error) {
      await interaction.reply({
        content: `❌ ${result.error}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: bio ? '✅ Your bio has been updated!' : '✅ Your bio has been cleared.',
      ephemeral: true,
    });
  }

  /**
   * Check if nym is available
   */
  private async isNymAvailable(nym: string): Promise<boolean> {
    const existing = profileService.getProfileByNym(nym);
    return existing === null;
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, session] of this.sessions) {
      const elapsed = now - session.lastInteractionAt.getTime();
      if (elapsed > SESSION_TIMEOUT_MS) {
        this.sessions.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ cleaned }, 'Cleaned up expired onboarding sessions');
    }

    return cleaned;
  }
}

/**
 * Singleton onboarding service instance
 */
export const onboardingService = new OnboardingService();
