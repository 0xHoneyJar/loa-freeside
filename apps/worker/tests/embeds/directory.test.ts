/**
 * Directory Embed Tests
 */

import { describe, it, expect } from 'vitest';
import {
  buildDirectoryEmbed,
  buildMemberPreviewEmbed,
  buildDirectoryComponents,
  DIRECTORY_INTERACTIONS,
  type DirectoryFiltersState,
} from '../../src/embeds/directory.js';
import type { DirectoryResult, DirectoryMember } from '../../src/data/index.js';

describe('buildDirectoryEmbed', () => {
  const mockMembers: DirectoryMember[] = [
    {
      profileId: 'profile-1',
      discordId: 'discord-1',
      nym: 'AlphaUser',
      tier: 'naib',
      tenureCategory: 'og',
      badgeCount: 15,
      joinedAt: new Date('2023-01-15'),
    },
    {
      profileId: 'profile-2',
      discordId: 'discord-2',
      nym: 'BetaUser',
      tier: 'fedaykin',
      tenureCategory: 'veteran',
      badgeCount: 8,
      joinedAt: new Date('2023-06-20'),
    },
    {
      profileId: 'profile-3',
      discordId: 'discord-3',
      nym: 'GammaUser',
      tier: null,
      tenureCategory: 'member',
      badgeCount: 2,
      joinedAt: new Date('2024-03-10'),
    },
  ];

  const mockResult: DirectoryResult = {
    members: mockMembers,
    total: 50,
    page: 1,
    pageSize: 10,
    totalPages: 5,
  };

  it('should build embed with member list', () => {
    const embed = buildDirectoryEmbed(mockResult);

    expect(embed.title).toContain('Member Directory');
    expect(embed.description).toContain('AlphaUser');
    expect(embed.description).toContain('BetaUser');
    expect(embed.description).toContain('GammaUser');
  });

  it('should show tier emojis for naib and fedaykin', () => {
    const embed = buildDirectoryEmbed(mockResult);

    // Naib gets crown
    expect(embed.description).toContain('👑');
    // Fedaykin gets sword
    expect(embed.description).toContain('⚔️');
  });

  it('should show tenure emojis', () => {
    const embed = buildDirectoryEmbed(mockResult);

    // OG gets temple
    expect(embed.description).toContain('🏛️');
    // Veteran gets star
    expect(embed.description).toContain('⭐');
    // Member gets seedling
    expect(embed.description).toContain('🌱');
  });

  it('should show badge counts for members with badges', () => {
    const embed = buildDirectoryEmbed(mockResult);

    expect(embed.description).toContain('15 badges');
    expect(embed.description).toContain('8 badges');
    expect(embed.description).toContain('2 badges');
  });

  it('should show pagination info in footer', () => {
    const embed = buildDirectoryEmbed(mockResult);

    expect(embed.footer?.text).toContain('Page 1/5');
    expect(embed.footer?.text).toContain('50 total members');
  });

  it('should show correct numbering on later pages', () => {
    const page2Result: DirectoryResult = {
      ...mockResult,
      page: 2,
    };

    const embed = buildDirectoryEmbed(page2Result);

    // Page 2 with pageSize 10 starts at 11
    expect(embed.description).toContain('11.');
    expect(embed.description).toContain('12.');
    expect(embed.description).toContain('13.');
  });

  it('should handle empty results', () => {
    const emptyResult: DirectoryResult = {
      members: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    };

    const embed = buildDirectoryEmbed(emptyResult);

    expect(embed.description).toContain('No members found');
  });

  it('should allow custom title', () => {
    const embed = buildDirectoryEmbed(mockResult, 'Naib Members');

    expect(embed.title).toContain('Naib Members');
  });
});

describe('buildMemberPreviewEmbed', () => {
  const naibMember: DirectoryMember = {
    profileId: 'profile-1',
    discordId: 'discord-1',
    nym: 'EliteUser',
    tier: 'naib',
    tenureCategory: 'og',
    badgeCount: 25,
    joinedAt: new Date('2022-05-15'),
  };

  const fedaykinMember: DirectoryMember = {
    profileId: 'profile-2',
    discordId: 'discord-2',
    nym: 'WarriorUser',
    tier: 'fedaykin',
    tenureCategory: 'elder',
    badgeCount: 12,
    joinedAt: new Date('2023-08-20'),
  };

  it('should show member name with tier emoji', () => {
    const embed = buildMemberPreviewEmbed(naibMember);

    expect(embed.title).toContain('👑');
    expect(embed.title).toContain('EliteUser');
  });

  it('should show tier field', () => {
    const embed = buildMemberPreviewEmbed(naibMember);
    const tierField = embed.fields?.find((f) => f.name === 'Tier');

    expect(tierField).toBeDefined();
    expect(tierField?.value).toContain('Naib');
    expect(tierField?.value).toContain('Top 7');
  });

  it('should show tenure field', () => {
    const embed = buildMemberPreviewEmbed(naibMember);
    const tenureField = embed.fields?.find((f) => f.name === 'Tenure');

    expect(tenureField).toBeDefined();
    expect(tenureField?.value).toContain('Og');
  });

  it('should show badge count field', () => {
    const embed = buildMemberPreviewEmbed(naibMember);
    const badgeField = embed.fields?.find((f) => f.name === 'Badges');

    expect(badgeField).toBeDefined();
    expect(badgeField?.value).toContain('25 earned');
  });

  it('should show member since date in footer', () => {
    const embed = buildMemberPreviewEmbed(naibMember);

    expect(embed.footer?.text).toContain('Member since');
    expect(embed.footer?.text).toContain('2022');
  });

  it('should use different color for fedaykin', () => {
    const naibEmbed = buildMemberPreviewEmbed(naibMember);
    const fedaykinEmbed = buildMemberPreviewEmbed(fedaykinMember);

    // Colors should be different (gold vs blue)
    expect(naibEmbed.color).not.toEqual(fedaykinEmbed.color);
  });
});

describe('buildDirectoryComponents', () => {
  const defaultFilters: DirectoryFiltersState = {
    page: 1,
    pageSize: 10,
    sortBy: 'nym',
    sortDir: 'asc',
  };

  it('should return three action rows', () => {
    const components = buildDirectoryComponents(defaultFilters, 1, 5);

    expect(components).toHaveLength(3);
  });

  it('should have tier filter dropdown in first row', () => {
    const components = buildDirectoryComponents(defaultFilters, 1, 5) as any[];
    const tierRow = components[0];

    expect(tierRow.type).toBe(1); // ACTION_ROW
    expect(tierRow.components[0].type).toBe(3); // STRING_SELECT
    expect(tierRow.components[0].custom_id).toBe(DIRECTORY_INTERACTIONS.tierFilter);
  });

  it('should have sort dropdown in second row', () => {
    const components = buildDirectoryComponents(defaultFilters, 1, 5) as any[];
    const sortRow = components[1];

    expect(sortRow.type).toBe(1);
    expect(sortRow.components[0].custom_id).toBe(DIRECTORY_INTERACTIONS.sortBy);
  });

  it('should have pagination buttons in third row', () => {
    const components = buildDirectoryComponents(defaultFilters, 1, 5) as any[];
    const buttonRow = components[2];

    expect(buttonRow.type).toBe(1);
    expect(buttonRow.components).toHaveLength(3);
    expect(buttonRow.components[0].custom_id).toBe(DIRECTORY_INTERACTIONS.prevPage);
    expect(buttonRow.components[1].custom_id).toBe(DIRECTORY_INTERACTIONS.refresh);
    expect(buttonRow.components[2].custom_id).toBe(DIRECTORY_INTERACTIONS.nextPage);
  });

  it('should disable prev button on first page', () => {
    const components = buildDirectoryComponents(defaultFilters, 1, 5) as any[];
    const buttonRow = components[2];
    const prevButton = buttonRow.components[0];

    expect(prevButton.disabled).toBe(true);
  });

  it('should disable next button on last page', () => {
    const components = buildDirectoryComponents(defaultFilters, 5, 5) as any[];
    const buttonRow = components[2];
    const nextButton = buttonRow.components[2];

    expect(nextButton.disabled).toBe(true);
  });

  it('should enable both buttons on middle pages', () => {
    const components = buildDirectoryComponents(defaultFilters, 3, 5) as any[];
    const buttonRow = components[2];

    expect(buttonRow.components[0].disabled).toBe(false);
    expect(buttonRow.components[2].disabled).toBe(false);
  });

  it('should mark current tier filter as default', () => {
    const filtersWithTier: DirectoryFiltersState = {
      ...defaultFilters,
      tier: 'naib',
    };

    const components = buildDirectoryComponents(filtersWithTier, 1, 5) as any[];
    const tierOptions = components[0].components[0].options;

    const naibOption = tierOptions.find((o: any) => o.value === 'naib');
    const allOption = tierOptions.find((o: any) => o.value === 'all');

    expect(naibOption.default).toBe(true);
    expect(allOption.default).toBe(false);
  });

  it('should mark current sort option as default', () => {
    const filtersWithSort: DirectoryFiltersState = {
      ...defaultFilters,
      sortBy: 'badgeCount',
    };

    const components = buildDirectoryComponents(filtersWithSort, 1, 5) as any[];
    const sortOptions = components[1].components[0].options;

    const badgeOption = sortOptions.find((o: any) => o.value === 'badgeCount');
    const nymOption = sortOptions.find((o: any) => o.value === 'nym');

    expect(badgeOption.default).toBe(true);
    expect(nymOption.default).toBe(false);
  });
});

describe('DIRECTORY_INTERACTIONS', () => {
  it('should have all required interaction IDs', () => {
    expect(DIRECTORY_INTERACTIONS.prevPage).toBe('directory_prev');
    expect(DIRECTORY_INTERACTIONS.nextPage).toBe('directory_next');
    expect(DIRECTORY_INTERACTIONS.refresh).toBe('directory_refresh');
    expect(DIRECTORY_INTERACTIONS.tierFilter).toBe('directory_tier');
    expect(DIRECTORY_INTERACTIONS.sortBy).toBe('directory_sort');
  });
});
