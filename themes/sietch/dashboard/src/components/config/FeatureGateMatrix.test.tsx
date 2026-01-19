/**
 * FeatureGateMatrix Component Tests
 *
 * Sprint 129: Feature Gate Matrix
 *
 * Tests for the feature gate matrix component.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  FeatureGateMatrix,
  type FeatureConfig,
  type TierInfo,
} from './FeatureGateMatrix';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTiers: TierInfo[] = [
  { id: 'wanderer', name: 'Wanderer', level: 0 },
  { id: 'initiate', name: 'Initiate', level: 1 },
  { id: 'fremen', name: 'Fremen', level: 2 },
  { id: 'naib', name: 'Naib', level: 3 },
];

const mockFeatures: FeatureConfig[] = [
  {
    id: 'feature-1',
    name: 'Basic Chat',
    description: 'Access to basic chat channels',
    category: 'Communication',
    enabledTiers: ['wanderer', 'initiate', 'fremen', 'naib'],
  },
  {
    id: 'feature-2',
    name: 'Voice Channels',
    description: 'Access to voice chat rooms',
    category: 'Communication',
    enabledTiers: ['initiate', 'fremen', 'naib'],
  },
  {
    id: 'feature-3',
    name: 'Custom Emojis',
    description: 'Use custom server emojis',
    category: 'Customization',
    enabledTiers: ['fremen', 'naib'],
    orConditions: [
      { id: 'nft-holder', type: 'nft', label: 'NFT Holder' },
    ],
  },
  {
    id: 'feature-4',
    name: 'Admin Panel',
    description: 'Access server admin controls',
    category: 'Administration',
    enabledTiers: ['naib'],
  },
];

// =============================================================================
// Tests
// =============================================================================

describe('FeatureGateMatrix', () => {
  describe('rendering', () => {
    it('should render all features', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Basic Chat')).toBeInTheDocument();
      expect(screen.getByText('Voice Channels')).toBeInTheDocument();
      expect(screen.getByText('Custom Emojis')).toBeInTheDocument();
      expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    });

    it('should render all tier columns', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Wanderer')).toBeInTheDocument();
      expect(screen.getByText('Initiate')).toBeInTheDocument();
      expect(screen.getByText('Fremen')).toBeInTheDocument();
      expect(screen.getByText('Naib')).toBeInTheDocument();
    });

    it('should render tier levels', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Level 0')).toBeInTheDocument();
      expect(screen.getByText('Level 1')).toBeInTheDocument();
      expect(screen.getByText('Level 2')).toBeInTheDocument();
      expect(screen.getByText('Level 3')).toBeInTheDocument();
    });

    it('should render loading state', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
          isLoading
        />
      );

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
      expect(screen.queryByText('Basic Chat')).not.toBeInTheDocument();
    });

    it('should render error state', () => {
      const errorMessage = 'Failed to load features';
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
          error={errorMessage}
        />
      );

      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('should render empty state', () => {
      render(
        <FeatureGateMatrix features={[]} tiers={mockTiers} onUpdate={vi.fn()} />
      );

      expect(screen.getByText('No features configured')).toBeInTheDocument();
    });

    it('should group features by category', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // Categories appear in both dropdown and table, use getAllByText
      expect(screen.getAllByText('Communication').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Customization').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Administration').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('checkbox states', () => {
    it('should show checked state for enabled tiers', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // Basic Chat is enabled for all tiers
      const basicChatCheckbox = screen.getByLabelText(
        /basic chat enabled for wanderer/i
      );
      expect(basicChatCheckbox).toHaveAttribute('aria-pressed', 'true');

      // Voice Channels is NOT enabled for Wanderer
      const voiceCheckbox = screen.getByLabelText(
        /voice channels enabled for wanderer/i
      );
      expect(voiceCheckbox).toHaveAttribute('aria-pressed', 'false');
    });

    it('should call onUpdate when toggling a feature', () => {
      const onUpdate = vi.fn();
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      // Enable Voice Channels for Wanderer
      const checkbox = screen.getByLabelText(/voice channels enabled for wanderer/i);
      fireEvent.click(checkbox);

      expect(onUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'feature-2',
            enabledTiers: expect.arrayContaining(['wanderer']),
          }),
        ])
      );
    });

    it('should disable checkbox when removing access', () => {
      const onUpdate = vi.fn();
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      // Disable Voice Channels for Initiate
      const checkbox = screen.getByLabelText(/voice channels enabled for initiate/i);
      fireEvent.click(checkbox);

      expect(onUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'feature-2',
            enabledTiers: expect.not.arrayContaining(['initiate']),
          }),
        ])
      );
    });
  });

  describe('OR conditions', () => {
    it('should display OR badge for features with conditions', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // Custom Emojis has OR conditions
      expect(screen.getByText('OR +1')).toBeInTheDocument();
    });

    it('should show OR conditions in tooltip', async () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // Hover over Custom Emojis - the tooltip appears on the div containing the feature name
      const featureName = screen.getByText('Custom Emojis');
      const hoverTarget = featureName.closest('div[class*="flex items-center"]')!;
      fireEvent.mouseEnter(hoverTarget);

      await waitFor(() => {
        // OR conditions are shown in the tooltip with bullet points
        expect(screen.getByText(/NFT Holder/)).toBeInTheDocument();
      });
    });
  });

  describe('feature tooltips', () => {
    it('should show feature description on hover', async () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const featureName = screen.getByText('Basic Chat');
      fireEvent.mouseEnter(featureName.parentElement!);

      await waitFor(() => {
        expect(screen.getByText('Access to basic chat channels')).toBeInTheDocument();
      });
    });

    it('should hide tooltip on mouse leave', async () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const featureName = screen.getByText('Basic Chat');
      fireEvent.mouseEnter(featureName.parentElement!);

      await waitFor(() => {
        expect(screen.getByText('Access to basic chat channels')).toBeInTheDocument();
      });

      fireEvent.mouseLeave(featureName.parentElement!);

      await waitFor(() => {
        expect(screen.queryByText('Access to basic chat channels')).not.toBeInTheDocument();
      });
    });
  });

  describe('category filter', () => {
    it('should filter features by selected category', async () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const categorySelect = screen.getByLabelText(/filter by category/i);
      fireEvent.change(categorySelect, { target: { value: 'Communication' } });

      // Should only show Communication features
      expect(screen.getByText('Basic Chat')).toBeInTheDocument();
      expect(screen.getByText('Voice Channels')).toBeInTheDocument();
      expect(screen.queryByText('Custom Emojis')).not.toBeInTheDocument();
      expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
    });

    it('should show all features when filter is cleared', async () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const categorySelect = screen.getByLabelText(/filter by category/i);

      // Filter to one category
      fireEvent.change(categorySelect, { target: { value: 'Communication' } });
      expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();

      // Clear filter
      fireEvent.change(categorySelect, { target: { value: '' } });
      expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    });
  });

  describe('batch mode', () => {
    it('should show batch mode toggle button', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Batch Update')).toBeInTheDocument();
    });

    it('should enter batch mode when clicking toggle', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const batchButton = screen.getByText('Batch Update');
      fireEvent.click(batchButton);

      // Should show checkboxes for feature selection
      expect(screen.getByLabelText(/select basic chat for batch update/i)).toBeInTheDocument();
      expect(screen.getByText('Exit Batch Mode')).toBeInTheDocument();
    });

    it('should select features in batch mode', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // Enter batch mode
      fireEvent.click(screen.getByText('Batch Update'));

      // Select a feature
      const checkbox = screen.getByLabelText(/select basic chat for batch update/i);
      fireEvent.click(checkbox);

      // Should show selection count
      expect(screen.getByText(/1 feature selected/i)).toBeInTheDocument();
    });

    it('should select all features', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // Enter batch mode
      fireEvent.click(screen.getByText('Batch Update'));

      // Click select all
      const selectAll = screen.getByLabelText(/select all features/i);
      fireEvent.click(selectAll);

      expect(screen.getByText(/4 features selected/i)).toBeInTheDocument();
    });

    it('should batch enable features for a tier', () => {
      const onUpdate = vi.fn();
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      // Enter batch mode
      fireEvent.click(screen.getByText('Batch Update'));

      // Select features
      fireEvent.click(screen.getByLabelText(/select voice channels for batch update/i));
      fireEvent.click(screen.getByLabelText(/select custom emojis for batch update/i));

      // Find the batch action bar and click enable for Wanderer
      const actionBar = screen.getByText(/2 features selected/i).closest('div')!;
      const enableButtons = within(actionBar).getAllByText('Wanderer');
      // First Wanderer button is "Enable for", second is "Disable for"
      fireEvent.click(enableButtons[0]);

      expect(onUpdate).toHaveBeenCalled();
    });

    it('should batch disable features for a tier', () => {
      const onUpdate = vi.fn();
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      // Enter batch mode
      fireEvent.click(screen.getByText('Batch Update'));

      // Select features
      fireEvent.click(screen.getByLabelText(/select basic chat for batch update/i));

      // Find and click disable for Naib (second set of tier buttons)
      const actionBar = screen.getByText(/1 feature selected/i).closest('div')!;
      const disableLabel = within(actionBar).getByText(/disable for/i);
      const disableSection = disableLabel.parentElement!;
      const naibButton = within(disableSection).getByText('Naib');
      fireEvent.click(naibButton);

      expect(onUpdate).toHaveBeenCalled();
    });

    it('should clear selection when exiting batch mode', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // Enter batch mode and select
      fireEvent.click(screen.getByText('Batch Update'));
      fireEvent.click(screen.getByLabelText(/select basic chat for batch update/i));
      expect(screen.getByText(/1 feature selected/i)).toBeInTheDocument();

      // Exit batch mode
      fireEvent.click(screen.getByText('Exit Batch Mode'));

      // Re-enter batch mode
      fireEvent.click(screen.getByText('Batch Update'));

      // Selection should be cleared
      expect(screen.queryByText(/feature selected/i)).not.toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('should disable all checkboxes when disabled prop is true', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
          disabled
        />
      );

      const checkbox = screen.getByLabelText(/basic chat enabled for wanderer/i);
      expect(checkbox).toBeDisabled();
    });
  });

  describe('accessibility', () => {
    it('should have accessible checkbox labels', () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // Check for accessible labels
      expect(
        screen.getByLabelText(/basic chat enabled for wanderer/i)
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/admin panel enabled for naib/i)
      ).toBeInTheDocument();
    });

    it('should have role="tooltip" on feature tooltips', async () => {
      render(
        <FeatureGateMatrix
          features={mockFeatures}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const featureName = screen.getByText('Basic Chat');
      fireEvent.mouseEnter(featureName.parentElement!);

      await waitFor(() => {
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
      });
    });
  });
});
