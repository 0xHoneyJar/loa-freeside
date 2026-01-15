/**
 * Common Embed Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  Colors,
  formatBgt,
  formatDate,
  createEmbed,
  createErrorEmbed,
} from '../../src/embeds/common.js';

describe('Colors', () => {
  it('should have expected color values', () => {
    expect(Colors.GOLD).toBe(0xd4af37);
    expect(Colors.BLUE).toBe(0x4169e1);
    expect(Colors.GREEN).toBe(0x2e8b57);
    expect(Colors.ORANGE).toBe(0xff8c00);
    expect(Colors.RED).toBe(0xdc143c);
    expect(Colors.PURPLE).toBe(0x9b59b6);
    expect(Colors.BROWN).toBe(0x8b4513);
    expect(Colors.AQUA).toBe(0x00d4ff);
  });
});

describe('formatBgt', () => {
  it('should format large amounts (>=1000) with 2 decimal places', () => {
    expect(formatBgt(1000)).toBe('1,000');
    expect(formatBgt(1234.5678)).toBe('1,234.57');
    expect(formatBgt(1000000)).toBe('1,000,000');
    expect(formatBgt(1234567.89)).toBe('1,234,567.89');
  });

  it('should format medium amounts (1-999) with 4 decimal places', () => {
    expect(formatBgt(1)).toBe('1');
    expect(formatBgt(500.1234)).toBe('500.1234');
    expect(formatBgt(99.999)).toBe('99.999');
  });

  it('should format small amounts (<1) with 6 decimal places', () => {
    expect(formatBgt(0)).toBe('0.000000');
    expect(formatBgt(0.123)).toBe('0.123000');
    expect(formatBgt(0.123456)).toBe('0.123456');
    expect(formatBgt(0.999999)).toBe('0.999999');
  });
});

describe('formatDate', () => {
  it('should format date in readable format', () => {
    const date = new Date('2024-03-15T10:30:00Z');
    const formatted = formatDate(date);
    // Should contain month, day, year
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2024/);
  });
});

describe('createEmbed', () => {
  it('should create basic embed with required fields', () => {
    const embed = createEmbed({
      title: 'Test Title',
      description: 'Test description',
      color: Colors.BLUE,
    });

    expect(embed.title).toBe('Test Title');
    expect(embed.description).toBe('Test description');
    expect(embed.color).toBe(Colors.BLUE);
  });

  it('should include optional fields when provided', () => {
    const embed = createEmbed({
      title: 'Test',
      color: Colors.GOLD,
      fields: [{ name: 'Field 1', value: 'Value 1', inline: true }],
      footer: 'Test footer',
      thumbnail: 'https://example.com/image.png',
    });

    expect(embed.fields).toHaveLength(1);
    expect(embed.fields![0].name).toBe('Field 1');
    expect(embed.footer?.text).toBe('Test footer');
    expect(embed.thumbnail?.url).toBe('https://example.com/image.png');
  });

  it('should include timestamp when specified', () => {
    const embed = createEmbed({
      title: 'Test',
      color: Colors.GREEN,
      timestamp: true,
    });

    expect(embed.timestamp).toBeDefined();
    expect(typeof embed.timestamp).toBe('string');
  });
});

describe('createErrorEmbed', () => {
  it('should create error embed with red color', () => {
    const embed = createErrorEmbed('Something went wrong');

    expect(embed.title).toBe('Error');
    expect(embed.description).toBe('Something went wrong');
    expect(embed.color).toBe(Colors.RED);
  });
});
