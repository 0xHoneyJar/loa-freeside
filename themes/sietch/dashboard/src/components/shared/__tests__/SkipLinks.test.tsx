/**
 * SkipLinks Component Tests
 *
 * Sprint 132: Performance & Accessibility
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SkipLinks } from '../SkipLinks';
import { DEFAULT_SKIP_LINKS } from '../../../utils/accessibility';

// Mock scrollIntoView which doesn't exist in jsdom
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('SkipLinks', () => {
  describe('rendering', () => {
    it('renders default skip links', () => {
      render(<SkipLinks />);

      expect(screen.getByText('Skip to main content')).toBeInTheDocument();
      expect(screen.getByText('Skip to navigation')).toBeInTheDocument();
    });

    it('renders custom skip links', () => {
      const customLinks = [
        { id: 'skip-sidebar', label: 'Skip to sidebar', targetId: 'sidebar' },
        { id: 'skip-footer', label: 'Skip to footer', targetId: 'footer' },
      ];

      render(<SkipLinks links={customLinks} />);

      expect(screen.getByText('Skip to sidebar')).toBeInTheDocument();
      expect(screen.getByText('Skip to footer')).toBeInTheDocument();
      expect(screen.queryByText('Skip to main content')).not.toBeInTheDocument();
    });

    it('has navigation role', () => {
      render(<SkipLinks />);

      const nav = screen.getByRole('navigation');
      expect(nav).toBeInTheDocument();
    });

    it('has aria-label for skip links', () => {
      render(<SkipLinks />);

      const nav = screen.getByRole('navigation');
      expect(nav).toHaveAttribute('aria-label', 'Skip links');
    });

    it('applies custom className', () => {
      render(<SkipLinks className="custom-skip-links" />);

      const nav = screen.getByRole('navigation');
      expect(nav).toHaveClass('custom-skip-links');
    });
  });

  describe('link attributes', () => {
    it('links have correct href', () => {
      render(<SkipLinks />);

      const mainContentLink = screen.getByText('Skip to main content');
      expect(mainContentLink).toHaveAttribute('href', '#main-content');
    });

    it('links have unique ids', () => {
      render(<SkipLinks />);

      const links = screen.getAllByRole('link');
      const ids = links.map((link) => link.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('links are visually hidden by default', () => {
      render(<SkipLinks />);

      const link = screen.getByText('Skip to main content');
      expect(link).toHaveClass('sr-only');
    });

    it('links become visible on focus', () => {
      render(<SkipLinks />);

      const link = screen.getByText('Skip to main content');
      expect(link).toHaveClass('focus:not-sr-only');
    });
  });

  describe('click behavior', () => {
    let mainContent: HTMLDivElement;

    beforeEach(() => {
      mainContent = document.createElement('div');
      mainContent.id = 'main-content';
      mainContent.tabIndex = -1;
      document.body.appendChild(mainContent);
    });

    afterEach(() => {
      document.body.removeChild(mainContent);
    });

    it('prevents default link behavior', () => {
      render(<SkipLinks />);

      const link = screen.getByText('Skip to main content');
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventDefault = vi.spyOn(event, 'preventDefault');

      link.dispatchEvent(event);

      expect(preventDefault).toHaveBeenCalled();
    });

    it('focuses target element on click', () => {
      render(<SkipLinks />);

      const link = screen.getByText('Skip to main content');
      const focusSpy = vi.spyOn(mainContent, 'focus');

      fireEvent.click(link);

      expect(focusSpy).toHaveBeenCalled();
    });

    it('scrolls target into view', () => {
      render(<SkipLinks />);

      const link = screen.getByText('Skip to main content');

      fireEvent.click(link);

      expect(mainContent.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      });
    });

    it('handles missing target gracefully', () => {
      const customLinks = [
        { id: 'skip-missing', label: 'Skip to missing', targetId: 'missing-element' },
      ];

      render(<SkipLinks links={customLinks} />);

      const link = screen.getByText('Skip to missing');

      // Should not throw
      expect(() => fireEvent.click(link)).not.toThrow();
    });
  });

  describe('DEFAULT_SKIP_LINKS', () => {
    it('has expected structure', () => {
      expect(DEFAULT_SKIP_LINKS).toHaveLength(2);
      expect(DEFAULT_SKIP_LINKS[0]).toHaveProperty('id');
      expect(DEFAULT_SKIP_LINKS[0]).toHaveProperty('label');
      expect(DEFAULT_SKIP_LINKS[0]).toHaveProperty('targetId');
    });

    it('includes main content link', () => {
      const mainLink = DEFAULT_SKIP_LINKS.find((l) => l.targetId === 'main-content');
      expect(mainLink).toBeDefined();
    });

    it('includes navigation link', () => {
      const navLink = DEFAULT_SKIP_LINKS.find((l) => l.targetId === 'main-nav');
      expect(navLink).toBeDefined();
    });
  });

  describe('styling', () => {
    it('positions container fixed at top-left', () => {
      render(<SkipLinks />);

      const nav = screen.getByRole('navigation');
      expect(nav).toHaveClass('fixed');
      expect(nav).toHaveClass('top-0');
      expect(nav).toHaveClass('left-0');
    });

    it('has high z-index', () => {
      render(<SkipLinks />);

      const nav = screen.getByRole('navigation');
      expect(nav).toHaveClass('z-50');
    });

    it('applies focus styles to links', () => {
      render(<SkipLinks />);

      const link = screen.getByText('Skip to main content');
      expect(link).toHaveClass('focus:absolute');
      expect(link).toHaveClass('focus:bg-amber-500');
      expect(link).toHaveClass('focus:text-black');
    });

    it('links have focus ring', () => {
      render(<SkipLinks />);

      const link = screen.getByText('Skip to main content');
      expect(link).toHaveClass('focus:ring-2');
      expect(link).toHaveClass('focus:ring-amber-400');
    });
  });

  describe('keyboard accessibility', () => {
    it('links are focusable', () => {
      render(<SkipLinks />);

      const link = screen.getByText('Skip to main content');
      link.focus();

      expect(document.activeElement).toBe(link);
    });

    it('multiple links can be tabbed through', () => {
      render(<SkipLinks />);

      const links = screen.getAllByRole('link');
      expect(links.length).toBe(2);

      // All links should be in tab order
      links.forEach((link) => {
        expect(link).not.toHaveAttribute('tabindex', '-1');
      });
    });
  });
});
