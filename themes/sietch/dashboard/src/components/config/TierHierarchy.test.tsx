/**
 * TierHierarchy Component Tests
 *
 * Sprint 127: Tier Hierarchy Visualizer
 *
 * Tests for the tier hierarchy visualization component.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TierHierarchy, type TierData } from './TierHierarchy';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTiers: TierData[] = [
  {
    id: 'wanderer',
    name: 'Wanderer',
    level: 0,
    thresholds: {},
    color: '#92400e',
    userCount: 5000,
    features: ['View public channels'],
  },
  {
    id: 'initiate',
    name: 'Initiate',
    level: 1,
    thresholds: { bgt: 10 },
    color: '#b45309',
    userCount: 2000,
    features: ['View public channels', 'Post in general'],
  },
  {
    id: 'fremen',
    name: 'Fremen',
    level: 2,
    thresholds: { bgt: 100, engagement: 50 },
    color: '#d97706',
    userCount: 500,
    features: ['View public channels', 'Post in general', 'Access alpha'],
  },
  {
    id: 'naib',
    name: 'Naib',
    level: 3,
    thresholds: { bgt: 1000, engagement: 100, tenure: 30 },
    color: '#f59e0b',
    userCount: 50,
    features: ['Full access', 'Governance voting'],
  },
  {
    id: 'council',
    name: 'Fremen Council',
    level: 4,
    thresholds: { bgt: 10000, engagement: 200, tenure: 90, activity: 80 },
    color: '#fbbf24',
    userCount: 5,
    features: ['Full access', 'Governance voting', 'Admin panel'],
  },
];

// =============================================================================
// Tests
// =============================================================================

describe('TierHierarchy', () => {
  describe('rendering', () => {
    it('should render all tiers', () => {
      render(<TierHierarchy tiers={mockTiers} />);

      expect(screen.getByText('Wanderer')).toBeInTheDocument();
      expect(screen.getByText('Initiate')).toBeInTheDocument();
      expect(screen.getByText('Fremen')).toBeInTheDocument();
      expect(screen.getByText('Naib')).toBeInTheDocument();
      expect(screen.getByText('Fremen Council')).toBeInTheDocument();
    });

    it('should display user counts', () => {
      render(<TierHierarchy tiers={mockTiers} />);

      expect(screen.getByText('5,000 users')).toBeInTheDocument();
      expect(screen.getByText('2,000 users')).toBeInTheDocument();
      expect(screen.getByText('500 users')).toBeInTheDocument();
      expect(screen.getByText('50 users')).toBeInTheDocument();
      expect(screen.getByText('5 users')).toBeInTheDocument();
    });

    it('should render empty state when no tiers', () => {
      render(<TierHierarchy tiers={[]} />);

      expect(screen.getByText('No tiers configured')).toBeInTheDocument();
    });

    it('should render loading state', () => {
      render(<TierHierarchy tiers={mockTiers} isLoading />);

      expect(screen.queryByText('Wanderer')).not.toBeInTheDocument();
      // Loading spinner should be present
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should render error state', () => {
      const errorMessage = 'Failed to load tiers';
      render(<TierHierarchy tiers={[]} error={errorMessage} />);

      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onTierSelect when tier is clicked', () => {
      const handleSelect = vi.fn();
      render(<TierHierarchy tiers={mockTiers} onTierSelect={handleSelect} />);

      fireEvent.click(screen.getByText('Fremen'));

      expect(handleSelect).toHaveBeenCalledWith('fremen');
    });

    it('should show selected state when tier is selected', () => {
      render(<TierHierarchy tiers={mockTiers} selectedTierId="naib" />);

      // The detail panel should show the selected tier
      expect(screen.getByText('Level 3')).toBeInTheDocument();
    });

    it('should handle keyboard navigation', () => {
      const handleSelect = vi.fn();
      render(<TierHierarchy tiers={mockTiers} onTierSelect={handleSelect} />);

      const tierNode = screen.getByLabelText(/Tier: Initiate/);
      fireEvent.keyDown(tierNode, { key: 'Enter' });

      expect(handleSelect).toHaveBeenCalledWith('initiate');
    });

    it('should toggle selection when clicking same tier twice', () => {
      render(<TierHierarchy tiers={mockTiers} />);

      // Use aria-label to get exact tier button (avoids matching "Fremen Council")
      const fremenTier = screen.getByLabelText(/Tier: Fremen, 500 users/);
      fireEvent.click(fremenTier);
      expect(screen.getByText('Level 2')).toBeInTheDocument();

      // Click again - should close (using internal state)
      fireEvent.click(fremenTier);
      // Detail panel should be closed
      expect(screen.queryByText('Level 2')).not.toBeInTheDocument();
    });
  });

  describe('detail panel', () => {
    it('should show thresholds in detail panel', () => {
      render(<TierHierarchy tiers={mockTiers} selectedTierId="naib" />);

      expect(screen.getByText('Thresholds')).toBeInTheDocument();
      expect(screen.getByText('BGT Holdings')).toBeInTheDocument();
      expect(screen.getByText('1,000')).toBeInTheDocument();
      expect(screen.getByText('Engagement')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('should show features in detail panel', () => {
      render(<TierHierarchy tiers={mockTiers} selectedTierId="naib" />);

      expect(screen.getByText('Features')).toBeInTheDocument();
      expect(screen.getByText('Full access')).toBeInTheDocument();
      expect(screen.getByText('Governance voting')).toBeInTheDocument();
    });

    it('should close detail panel when close button clicked', () => {
      const handleSelect = vi.fn();
      render(
        <TierHierarchy
          tiers={mockTiers}
          selectedTierId="naib"
          onTierSelect={handleSelect}
        />
      );

      const closeButton = screen.getByLabelText('Close panel');
      fireEvent.click(closeButton);

      expect(handleSelect).toHaveBeenCalledWith('');
    });
  });

  describe('responsive design', () => {
    it('should have proper ARIA attributes for accessibility', () => {
      render(<TierHierarchy tiers={mockTiers} selectedTierId="fremen" />);

      const tierList = screen.getByRole('list', { name: 'Tier hierarchy' });
      expect(tierList).toBeInTheDocument();

      // Use getAllByLabelText since "Fremen" appears in multiple tiers
      const allTierButtons = screen.getAllByRole('button');
      const fremenTier = allTierButtons.find(btn =>
        btn.getAttribute('aria-label')?.includes('Tier: Fremen,')
      );
      expect(fremenTier).toHaveAttribute('aria-selected', 'true');

      const wandererTier = screen.getByLabelText(/Tier: Wanderer/);
      expect(wandererTier).toHaveAttribute('aria-selected', 'false');
    });
  });

  describe('pyramid layout', () => {
    it('should render highest tier at top (narrowest)', () => {
      render(<TierHierarchy tiers={mockTiers} />);

      // The Fremen Council (highest level) should be at the top
      // We can verify the order by checking the DOM order
      const allTierNames = screen
        .getAllByRole('button')
        .map((btn) => btn.textContent);

      // First item should be the highest tier
      expect(allTierNames[0]).toContain('Fremen Council');
      // Last item should be the lowest tier
      expect(allTierNames[allTierNames.length - 1]).toContain('Wanderer');
    });
  });
});
