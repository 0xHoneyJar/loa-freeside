/**
 * Position Embed Tests
 */

import { describe, it, expect } from 'vitest';
import { buildPositionStatusEmbed, type PositionStatusData } from '../../src/embeds/position.js';
import { Colors } from '../../src/embeds/common.js';

describe('buildPositionStatusEmbed', () => {
  const baseData: PositionStatusData = {
    position: 25,
    bgt: 1500.5,
    distanceToAbove: 50,
    distanceToBelow: 30,
    distanceToEntry: null,
    isNaib: false,
    isFedaykin: true,
    isAtRisk: false,
  };

  it('should create embed with correct title', () => {
    const embed = buildPositionStatusEmbed(baseData);
    expect(embed.title).toContain('Position');
  });

  it('should use gold color for Naib', () => {
    const naibData = { ...baseData, isNaib: true, isFedaykin: true };
    const embed = buildPositionStatusEmbed(naibData);
    expect(embed.color).toBe(Colors.GOLD);
  });

  it('should use blue color for Fedaykin', () => {
    const embed = buildPositionStatusEmbed(baseData);
    expect(embed.color).toBe(Colors.BLUE);
  });

  it('should use orange color for at-risk positions', () => {
    const atRiskData = { ...baseData, isAtRisk: true };
    const embed = buildPositionStatusEmbed(atRiskData);
    expect(embed.color).toBe(Colors.ORANGE);
  });

  it('should use brown color for waitlist', () => {
    const waitlistData = {
      ...baseData,
      isFedaykin: false,
      position: 75,
      distanceToEntry: 100,
    };
    const embed = buildPositionStatusEmbed(waitlistData);
    expect(embed.color).toBe(Colors.BROWN);
  });

  it('should show Naib status for top 7', () => {
    const naibData = { ...baseData, isNaib: true, position: 3 };
    const embed = buildPositionStatusEmbed(naibData);
    expect(embed.description).toContain('Naib');
    expect(embed.description).toContain('Top 7');
  });

  it('should show At Risk status', () => {
    const atRiskData = { ...baseData, isAtRisk: true, position: 65 };
    const embed = buildPositionStatusEmbed(atRiskData);
    expect(embed.description).toContain('At Risk');
  });

  it('should show Fedaykin status', () => {
    const embed = buildPositionStatusEmbed(baseData);
    expect(embed.description).toContain('Fedaykin');
  });

  it('should show Waiting Pool status for non-eligible', () => {
    const waitlistData = { ...baseData, isFedaykin: false };
    const embed = buildPositionStatusEmbed(waitlistData);
    expect(embed.description).toContain('Waiting Pool');
  });

  it('should include position field', () => {
    const embed = buildPositionStatusEmbed(baseData);
    const positionField = embed.fields?.find((f) => f.name.includes('Position'));
    expect(positionField).toBeDefined();
    expect(positionField?.value).toContain('#25');
  });

  it('should include BGT holdings field', () => {
    const embed = buildPositionStatusEmbed(baseData);
    const bgtField = embed.fields?.find((f) => f.name.includes('BGT'));
    expect(bgtField).toBeDefined();
    expect(bgtField?.value).toContain('1,500.5');
  });

  it('should include distance to move up when available', () => {
    const embed = buildPositionStatusEmbed(baseData);
    const moveUpField = embed.fields?.find((f) => f.name.includes('Move Up'));
    expect(moveUpField).toBeDefined();
    expect(moveUpField?.value).toContain('50');
  });

  it('should include buffer distance when available', () => {
    const embed = buildPositionStatusEmbed(baseData);
    const bufferField = embed.fields?.find((f) => f.name.includes('Buffer'));
    expect(bufferField).toBeDefined();
    expect(bufferField?.value).toContain('30');
  });

  it('should show distance to entry for waitlist members', () => {
    const waitlistData = {
      ...baseData,
      isFedaykin: false,
      position: 75,
      distanceToEntry: 100,
    };
    const embed = buildPositionStatusEmbed(waitlistData);
    const entryField = embed.fields?.find((f) => f.name.includes('Entry'));
    expect(entryField).toBeDefined();
    expect(entryField?.value).toContain('100');
  });

  it('should not show distance to entry for eligible members', () => {
    const dataWithEntry = { ...baseData, distanceToEntry: 100 };
    const embed = buildPositionStatusEmbed(dataWithEntry);
    const entryField = embed.fields?.find((f) => f.name.includes('To Entry'));
    expect(entryField).toBeUndefined();
  });

  it('should include footer with alerts info', () => {
    const embed = buildPositionStatusEmbed(baseData);
    expect(embed.footer?.text).toContain('alerts');
  });

  it('should handle position 1 (no distance to above)', () => {
    const topData = {
      ...baseData,
      position: 1,
      isNaib: true,
      distanceToAbove: null,
    };
    const embed = buildPositionStatusEmbed(topData);
    const moveUpField = embed.fields?.find((f) => f.name.includes('Move Up'));
    expect(moveUpField).toBeUndefined();
  });
});
