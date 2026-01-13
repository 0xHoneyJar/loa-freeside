/**
 * Discord Autocomplete Handler
 *
 * Handles autocomplete interactions for slash commands (nym search, badge search, etc.)
 */

import type { AutocompleteInteraction } from 'discord.js';
import { profileService } from '../../profile.js';
import {
  handleBadgesAutocomplete,
  handleAdminBadgeAutocomplete,
  handleAdminWaterShareAutocomplete,
} from '../../../discord/commands/index.js';

/**
 * Handle autocomplete interactions (for nym search)
 */
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const { commandName } = interaction;
  const focusedOption = interaction.options.getFocused(true);

  // Profile command autocomplete
  if (commandName === 'profile' && focusedOption.name === 'nym') {
    const query = focusedOption.value;
    const results = profileService.searchByNym(query, 25);

    await interaction.respond(
      results.map((profile) => ({
        name: profile.nym,
        value: profile.nym,
      }))
    );
    return;
  }

  // Badges command autocomplete
  if (commandName === 'badges') {
    await handleBadgesAutocomplete(interaction);
    return;
  }

  // Admin-badge command autocomplete
  if (commandName === 'admin-badge') {
    await handleAdminBadgeAutocomplete(interaction);
    return;
  }

  // Admin-water-share command autocomplete
  if (commandName === 'admin-water-share') {
    await handleAdminWaterShareAutocomplete(interaction);
    return;
  }

  await interaction.respond([]);
}
