/**
 * Threshold Embed Tests
 */

import { describe, it, expect } from 'vitest';
import {
  buildThresholdEmbed,
  type ThresholdData,
  type WaitlistPosition,
} from '../../src/embeds/threshold.js';
import { Colors } from '../../src/embeds/common.js';

describe('buildThresholdEmbed', () => {
  const baseThreshold: ThresholdData = {
    entryThreshold: 1000,
    eligibleCount: 69,
    waitlistCount: 31,
    gapToEntry: 150,
    updatedAt: new Date('2024-03-15'),
  };

  const topWaitlist: WaitlistPosition[] = [
    {
      position: 70,
      addressDisplay: '0x1234...5678',
      bgt: 950,
      distanceToEntry: 50,
      isRegistered: true,
    },
    {
      position: 71,
      addressDisplay: '0xabcd...efgh',
      bgt: 900,
      distanceToEntry: 100,
      isRegistered: false,
    },
  ];

  it('should create embed with correct title', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    expect(embed.title).toContain('Threshold');
  });

  it('should use brown color', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    expect(embed.color).toBe(Colors.BROWN);
  });

  it('should include description about entry requirements', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    expect(embed.description).toContain('entry');
    expect(embed.description).toContain('BGT');
  });

  it('should show entry threshold', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    const entryField = embed.fields?.find((f) => f.name.includes('Entry'));
    expect(entryField).toBeDefined();
    expect(entryField?.value).toContain('1,000');
    expect(entryField?.value).toContain('BGT');
  });

  it('should show statistics', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    const statsField = embed.fields?.find((f) => f.name.includes('Statistics'));
    expect(statsField).toBeDefined();
    expect(statsField?.value).toContain('69');
    expect(statsField?.value).toContain('31');
  });

  it('should show gap to entry when available', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    const gapField = embed.fields?.find((f) => f.name.includes('Gap'));
    expect(gapField).toBeDefined();
    expect(gapField?.value).toContain('150');
  });

  it('should not show gap when zero or null', () => {
    const noGapThreshold = { ...baseThreshold, gapToEntry: null };
    const embed = buildThresholdEmbed(noGapThreshold, topWaitlist);
    const gapField = embed.fields?.find((f) => f.name.includes('Gap'));
    expect(gapField).toBeUndefined();
  });

  it('should show waitlist positions', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    const waitlistField = embed.fields?.find((f) => f.name.includes('Waiting Pool'));
    expect(waitlistField).toBeDefined();
    expect(waitlistField?.value).toContain('#70');
    expect(waitlistField?.value).toContain('#71');
    expect(waitlistField?.value).toContain('0x1234');
  });

  it('should show registered indicator for registered wallets', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    const waitlistField = embed.fields?.find((f) => f.name.includes('Waiting Pool'));
    // The first wallet is registered, so it should have the indicator
    expect(waitlistField?.value).toContain('\ud83d\udcec'); // envelope emoji
  });

  it('should show empty waitlist message when no positions', () => {
    const embed = buildThresholdEmbed(baseThreshold, []);
    const waitlistField = embed.fields?.find((f) => f.name.includes('Waiting Pool'));
    expect(waitlistField).toBeDefined();
    expect(waitlistField?.value).toContain('No wallets');
  });

  it('should include footer with registration info', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    expect(embed.footer?.text).toContain('register');
  });

  it('should format BGT amounts correctly', () => {
    const largeThreshold = { ...baseThreshold, entryThreshold: 1234567.89 };
    const embed = buildThresholdEmbed(largeThreshold, topWaitlist);
    const entryField = embed.fields?.find((f) => f.name.includes('Entry'));
    expect(entryField?.value).toContain('1,234,567.89');
  });

  it('should show distance to entry for each waitlist position', () => {
    const embed = buildThresholdEmbed(baseThreshold, topWaitlist);
    const waitlistField = embed.fields?.find((f) => f.name.includes('Waiting Pool'));
    expect(waitlistField?.value).toContain('+50');
    expect(waitlistField?.value).toContain('+100');
    expect(waitlistField?.value).toContain('to entry');
  });
});
