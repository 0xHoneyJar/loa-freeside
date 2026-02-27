import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Avatar Service
 *
 * Generates deterministic avatars using the drunken bishop algorithm
 * (similar to SSH key fingerprint visualization) based on SHA-256 hashes.
 *
 * The generated pattern is always the same for a given input, providing
 * consistent pseudonymous visual identity.
 */

/**
 * Default avatar dimensions
 */
const DEFAULT_WIDTH = 17;
const DEFAULT_HEIGHT = 9;

/**
 * Color palettes for avatar generation
 * Each tier has its own distinct color scheme
 */
const COLOR_PALETTES = {
  naib: {
    background: '#0a0f1a', // Deep space blue
    low: '#1a2744',        // Dark blue
    mid: '#2d4a7c',        // Medium blue
    high: '#4a90d9',       // Bright blue
    peak: '#87ceeb',       // Sky blue highlight
  },
  fedaykin: {
    background: '#1a0f0a', // Deep amber
    low: '#44291a',        // Dark amber
    mid: '#7c4a2d',        // Medium amber
    high: '#d9904a',       // Bright amber
    peak: '#ffd700',       // Gold highlight
  },
} as const;

/**
 * ASCII characters for text-based avatar rendering
 * Ordered by "density" from empty to full
 */
const ASCII_CHARS = ' .:-=+*#%@';

/**
 * Movement directions for drunken bishop
 * Based on 2-bit pairs from hash:
 * 00 = NW, 01 = NE, 10 = SW, 11 = SE
 */
const DIRECTIONS = [
  { dx: -1, dy: -1 }, // 00: NW
  { dx: 1, dy: -1 },  // 01: NE
  { dx: -1, dy: 1 },  // 10: SW
  { dx: 1, dy: 1 },   // 11: SE
] as const;

/**
 * Avatar generation result
 */
export interface AvatarResult {
  /** Grid of values (0-max) representing visit counts */
  grid: number[][];
  /** Maximum value in the grid */
  maxValue: number;
  /** Width of the grid */
  width: number;
  /** Height of the grid */
  height: number;
  /** Starting position */
  start: { x: number; y: number };
  /** Ending position */
  end: { x: number; y: number };
  /** The SHA-256 hash used */
  hash: string;
}

/**
 * Avatar Service Class
 */
class AvatarService {
  /**
   * Generate SHA-256 hash from member ID
   */
  generateHash(memberId: string): string {
    return createHash('sha256').update(memberId).digest('hex');
  }

  /**
   * Run the drunken bishop algorithm
   *
   * The algorithm works by:
   * 1. Starting at the center of a grid
   * 2. Reading the hash as 2-bit pairs (4 movements per byte)
   * 3. Moving in the direction indicated by each pair
   * 4. Incrementing the visit count for each cell
   *
   * @param hash - SHA-256 hash string (64 hex chars)
   * @param width - Grid width (default 17)
   * @param height - Grid height (default 9)
   */
  runDrunkenBishop(
    hash: string,
    width: number = DEFAULT_WIDTH,
    height: number = DEFAULT_HEIGHT
  ): AvatarResult {
    // Initialize grid with zeros
    const grid: number[][] = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => 0)
    );

    // Start at center
    let x = Math.floor(width / 2);
    let y = Math.floor(height / 2);
    const start = { x, y };

    // Mark starting position
    grid[y][x] = (grid[y][x] ?? 0) + 1;

    // Process hash bytes (32 bytes = 64 hex chars)
    for (let i = 0; i < hash.length; i += 2) {
      const byte = parseInt(hash.slice(i, i + 2), 16);

      // Each byte has 4 2-bit pairs (processed LSB first)
      for (let bit = 0; bit < 4; bit++) {
        const direction = (byte >> (bit * 2)) & 0x03;
        const dir = DIRECTIONS[direction];

        // Move (with boundary clamping)
        x = Math.max(0, Math.min(width - 1, x + dir.dx));
        y = Math.max(0, Math.min(height - 1, y + dir.dy));

        // Increment visit count
        grid[y][x] = (grid[y][x] ?? 0) + 1;
      }
    }

    const end = { x, y };

    // Find max value for normalization
    let maxValue = 0;
    for (const row of grid) {
      for (const cell of row) {
        maxValue = Math.max(maxValue, cell);
      }
    }

    return {
      grid,
      maxValue,
      width,
      height,
      start,
      end,
      hash,
    };
  }

  /**
   * Generate avatar from member ID
   */
  generateAvatar(memberId: string): AvatarResult {
    const hash = this.generateHash(memberId);
    return this.runDrunkenBishop(hash);
  }

  /**
   * Render avatar as ASCII art
   */
  renderAscii(result: AvatarResult): string {
    const { grid, maxValue, start, end } = result;
    const lines: string[] = [];

    // Top border
    const firstRow = grid[0];
    lines.push('+' + '-'.repeat(firstRow ? firstRow.length : 0) + '+');

    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      if (!row) continue;

      let line = '|';
      for (let x = 0; x < row.length; x++) {
        // Special markers for start and end
        if (x === start.x && y === start.y) {
          line += 'S';
        } else if (x === end.x && y === end.y) {
          line += 'E';
        } else {
          // Map value to ASCII character
          const cellValue = row[x] ?? 0;
          const normalizedValue = maxValue > 0 ? cellValue / maxValue : 0;
          const charIndex = Math.min(
            Math.floor(normalizedValue * (ASCII_CHARS.length - 1)),
            ASCII_CHARS.length - 1
          );
          line += ASCII_CHARS[charIndex] ?? ' ';
        }
      }
      line += '|';
      lines.push(line);
    }

    // Bottom border
    lines.push('+' + '-'.repeat(firstRow ? firstRow.length : 0) + '+');

    return lines.join('\n');
  }

  /**
   * Render avatar as SVG string
   */
  renderSvg(
    result: AvatarResult,
    tier: 'naib' | 'fedaykin' = 'fedaykin',
    size: number = 200
  ): string {
    const { grid, maxValue, width, height } = result;
    const palette = COLOR_PALETTES[tier];

    const cellWidth = size / width;
    const cellHeight = size / height;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;

    // Background
    svg += `<rect width="${size}" height="${size}" fill="${palette.background}"/>`;

    // Draw cells
    for (let y = 0; y < height; y++) {
      const row = grid[y];
      if (!row) continue;

      for (let x = 0; x < width; x++) {
        const value = row[x] ?? 0;
        if (value === 0) continue;

        const normalizedValue = maxValue > 0 ? value / maxValue : 0;

        // Choose color based on intensity
        let fill: string;
        if (normalizedValue < 0.25) {
          fill = palette.low;
        } else if (normalizedValue < 0.5) {
          fill = palette.mid;
        } else if (normalizedValue < 0.75) {
          fill = palette.high;
        } else {
          fill = palette.peak;
        }

        // Add slight opacity variation for depth
        const opacity = 0.6 + normalizedValue * 0.4;

        svg += `<rect x="${x * cellWidth}" y="${y * cellHeight}" width="${cellWidth}" height="${cellHeight}" fill="${fill}" opacity="${opacity}"/>`;
      }
    }

    svg += '</svg>';
    return svg;
  }

  /**
   * Render avatar as data URL for embedding
   */
  renderDataUrl(
    result: AvatarResult,
    tier: 'naib' | 'fedaykin' = 'fedaykin',
    size: number = 200
  ): string {
    const svg = this.renderSvg(result, tier, size);
    const base64 = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
  }

  /**
   * Generate and render avatar for a member
   */
  getAvatarForMember(
    memberId: string,
    tier: 'naib' | 'fedaykin' = 'fedaykin',
    format: 'svg' | 'dataUrl' | 'ascii' = 'svg',
    size: number = 200
  ): string {
    const result = this.generateAvatar(memberId);

    switch (format) {
      case 'ascii':
        return this.renderAscii(result);
      case 'dataUrl':
        return this.renderDataUrl(result, tier, size);
      case 'svg':
      default:
        return this.renderSvg(result, tier, size);
    }
  }

  /**
   * Generate avatar grid values as JSON (for client-side rendering)
   */
  getAvatarData(memberId: string): {
    hash: string;
    grid: number[][];
    maxValue: number;
    dimensions: { width: number; height: number };
  } {
    const result = this.generateAvatar(memberId);
    return {
      hash: result.hash,
      grid: result.grid,
      maxValue: result.maxValue,
      dimensions: { width: result.width, height: result.height },
    };
  }

  /**
   * Verify avatar matches member ID (for integrity checks)
   */
  verifyAvatar(memberId: string, hash: string): boolean {
    const expectedHash = this.generateHash(memberId);
    return expectedHash === hash;
  }
}

/**
 * Singleton avatar service instance
 */
export const avatarService = new AvatarService();
