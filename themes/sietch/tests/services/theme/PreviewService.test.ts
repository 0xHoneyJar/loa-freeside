/**
 * Preview Service Tests
 *
 * Sprint 6: Component System - Preview Engine
 */

import { describe, it, expect, vi } from 'vitest';

// =============================================================================
// Mock Setup - Must be before imports
// =============================================================================

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// =============================================================================
// Imports after mocks
// =============================================================================

import { ThemePreviewService } from '../../../src/services/theme/PreviewService.js';
import type { Theme } from '../../../src/types/theme.types.js';

// =============================================================================
// Test Data
// =============================================================================

const createTestTheme = (overrides?: Partial<Theme>): Theme => ({
  id: 'theme-123',
  name: 'Test Theme',
  description: 'A test theme',
  communityId: 'community-123',
  createdBy: 'user-123',
  status: 'draft',
  version: '1.0.0',
  branding: {
    colors: {
      primary: '#2563eb',
      secondary: '#4f46e5',
      background: '#ffffff',
      surface: '#f9fafb',
      text: '#111827',
      accent: '#f59e0b',
    },
    fonts: {
      heading: { family: 'Inter', weight: 700 },
      body: { family: 'Inter', weight: 400 },
      mono: { family: 'Fira Code', weight: 400 },
    },
    borderRadius: 'md',
    spacing: 'md',
  },
  pages: [
    {
      id: 'page-1',
      name: 'Home',
      slug: 'home',
      components: [
        {
          id: 'comp-1',
          type: 'rich-text',
          props: {
            type: 'rich-text',
            content: 'Welcome to our community!',
            textAlign: 'center',
          },
          position: { x: 0, y: 0, width: 12, height: 2 },
        },
        {
          id: 'comp-2',
          type: 'leaderboard',
          props: {
            type: 'leaderboard',
            title: 'Top Members',
            dataSource: { type: 'points', sortOrder: 'desc' },
            maxEntries: 5,
          },
          position: { x: 0, y: 2, width: 6, height: 4 },
        },
        {
          id: 'comp-3',
          type: 'profile-card',
          props: {
            type: 'profile-card',
            showAvatar: true,
            showWallet: true,
          },
          position: { x: 6, y: 2, width: 6, height: 4 },
        },
      ],
    },
    {
      id: 'page-2',
      name: 'Gallery',
      slug: 'gallery',
      components: [
        {
          id: 'comp-4',
          type: 'nft-gallery',
          props: {
            type: 'nft-gallery',
            contractId: 'contract-123',
            layout: 'grid',
            columns: 4,
          },
          position: { x: 0, y: 0, width: 12, height: 6 },
        },
      ],
    },
  ],
  contracts: [],
  chains: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// =============================================================================
// Tests
// =============================================================================

describe('ThemePreviewService', () => {
  const previewService = new ThemePreviewService();

  describe('generatePreview', () => {
    it('should generate preview for default page', () => {
      const theme = createTestTheme();
      const result = previewService.generatePreview(theme);

      expect(result.html).toBeDefined();
      expect(result.css).toBeDefined();
      expect(result.page.slug).toBe('home');
      expect(result.viewport).toBe('desktop');
      expect(result.mockMode).toBe(true);
    });

    it('should generate preview for specific page', () => {
      const theme = createTestTheme();
      const result = previewService.generatePreview(theme, { pageId: 'page-2' });

      expect(result.page.id).toBe('page-2');
      expect(result.page.slug).toBe('gallery');
    });

    it('should throw error for invalid page ID', () => {
      const theme = createTestTheme();

      expect(() =>
        previewService.generatePreview(theme, { pageId: 'invalid-page' })
      ).toThrow('Page not found');
    });

    it('should support different viewports', () => {
      const theme = createTestTheme();

      const desktop = previewService.generatePreview(theme, { viewport: 'desktop' });
      const tablet = previewService.generatePreview(theme, { viewport: 'tablet' });
      const mobile = previewService.generatePreview(theme, { viewport: 'mobile' });

      expect(desktop.viewport).toBe('desktop');
      expect(tablet.viewport).toBe('tablet');
      expect(mobile.viewport).toBe('mobile');
    });

    it('should include all components in HTML', () => {
      const theme = createTestTheme();
      const result = previewService.generatePreview(theme);

      expect(result.html).toContain('data-component="rich-text"');
      expect(result.html).toContain('data-component="leaderboard"');
      expect(result.html).toContain('data-component="profile-card"');
    });

    it('should generate full HTML document when requested', () => {
      const theme = createTestTheme();
      const result = previewService.generatePreview(theme, { fullDocument: true });

      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.html).toContain('<html');
      expect(result.html).toContain('</html>');
      expect(result.html).toContain('<style>');
    });

    it('should generate CSS with theme variables', () => {
      const theme = createTestTheme();
      const result = previewService.generatePreview(theme);

      expect(result.css).toContain('--theme-primary');
      expect(result.css).toContain('--theme-background');
      expect(result.css).toContain('--theme-font-primary');
      expect(result.css).toContain('#2563eb'); // Primary color value
    });

    it('should return timestamp in result', () => {
      const theme = createTestTheme();
      const result = previewService.generatePreview(theme);

      expect(result.generatedAt).toBeDefined();
      expect(new Date(result.generatedAt).getTime()).not.toBeNaN();
    });
  });

  describe('mock mode', () => {
    it('should include mock data when mockMode is true', () => {
      const theme = createTestTheme();
      const result = previewService.generatePreview(theme, { mockMode: true });

      // Leaderboard should have mock entries
      expect(result.html).toContain('theme-leaderboard__entry');
    });

    it('should respect mockMode: false', () => {
      const theme = createTestTheme();
      const result = previewService.generatePreview(theme, { mockMode: false });

      expect(result.mockMode).toBe(false);
    });
  });

  describe('empty theme', () => {
    it('should handle theme with no pages', () => {
      const theme = createTestTheme({ pages: [] });

      expect(() => previewService.generatePreview(theme)).toThrow('Page not found');
    });

    it('should handle page with no components', () => {
      const theme = createTestTheme({
        pages: [{ id: 'empty', name: 'Empty', slug: 'empty', components: [] }],
      });

      const result = previewService.generatePreview(theme);
      expect(result.html).toContain('No components on this page');
    });
  });
});

describe('Component Renderers', () => {
  const previewService = new ThemePreviewService();

  describe('RichText Renderer', () => {
    it('should render markdown content', () => {
      const theme = createTestTheme({
        pages: [
          {
            id: 'test',
            name: 'Test',
            slug: 'test',
            components: [
              {
                id: 'rt-1',
                type: 'rich-text',
                props: {
                  type: 'rich-text',
                  content: '**Bold** and *italic* text',
                  textAlign: 'left',
                },
                position: { x: 0, y: 0, width: 12, height: 1 },
              },
            ],
          },
        ],
      });

      const result = previewService.generatePreview(theme);

      expect(result.html).toContain('<strong>Bold</strong>');
      expect(result.html).toContain('<em>italic</em>');
    });

    it('should apply text alignment', () => {
      const theme = createTestTheme({
        pages: [
          {
            id: 'test',
            name: 'Test',
            slug: 'test',
            components: [
              {
                id: 'rt-1',
                type: 'rich-text',
                props: {
                  type: 'rich-text',
                  content: 'Centered text',
                  textAlign: 'center',
                },
                position: { x: 0, y: 0, width: 12, height: 1 },
              },
            ],
          },
        ],
      });

      const result = previewService.generatePreview(theme);

      expect(result.html).toContain('align-center');
    });
  });

  describe('NFTGallery Renderer', () => {
    it('should render grid layout with columns', () => {
      const theme = createTestTheme({
        pages: [
          {
            id: 'test',
            name: 'Test',
            slug: 'test',
            components: [
              {
                id: 'nft-1',
                type: 'nft-gallery',
                props: {
                  type: 'nft-gallery',
                  contractId: 'contract-123',
                  layout: 'grid',
                  columns: 3,
                },
                position: { x: 0, y: 0, width: 12, height: 6 },
              },
            ],
          },
        ],
      });

      const result = previewService.generatePreview(theme);

      expect(result.html).toContain('data-component="nft-gallery"');
      expect(result.html).toContain('--columns: 3');
    });
  });

  describe('TokenGate Renderer', () => {
    it('should show unlocked content in mock mode', () => {
      const theme = createTestTheme({
        pages: [
          {
            id: 'test',
            name: 'Test',
            slug: 'test',
            components: [
              {
                id: 'gate-1',
                type: 'token-gate',
                props: {
                  type: 'token-gate',
                  gateConfig: { type: 'token', contractId: 'c1', minBalance: '100' },
                  unlockedContent: 'You have access!',
                },
                position: { x: 0, y: 0, width: 12, height: 2 },
              },
            ],
          },
        ],
      });

      const result = previewService.generatePreview(theme, { mockMode: true });

      expect(result.html).toContain('theme-token-gate--unlocked');
      expect(result.html).toContain('You have access!');
    });

    it('should show locked content when user lacks tokens', () => {
      const theme = createTestTheme({
        pages: [
          {
            id: 'test',
            name: 'Test',
            slug: 'test',
            components: [
              {
                id: 'gate-1',
                type: 'token-gate',
                props: {
                  type: 'token-gate',
                  gateConfig: { type: 'token', contractId: 'c1', minBalance: '100' },
                  lockedContent: 'Token required',
                },
                position: { x: 0, y: 0, width: 12, height: 2 },
              },
            ],
          },
        ],
      });

      // Without mock mode, user has no tokens
      const result = previewService.generatePreview(theme, { mockMode: false });

      expect(result.html).toContain('theme-token-gate--locked');
    });
  });
});
