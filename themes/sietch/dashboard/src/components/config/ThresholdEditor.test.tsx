/**
 * ThresholdEditor Component Tests
 *
 * Sprint 128: Threshold Editor
 *
 * Tests for the threshold editor component.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThresholdEditor, type TierConfig, type ImpactPreview } from './ThresholdEditor';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTiers: TierConfig[] = [
  {
    id: 'wanderer',
    name: 'Wanderer',
    level: 0,
    thresholds: { bgt: 0, engagement: 0, tenure: 0, activity: 0 },
  },
  {
    id: 'initiate',
    name: 'Initiate',
    level: 1,
    thresholds: { bgt: 10, engagement: 5, tenure: 7, activity: 10 },
  },
  {
    id: 'fremen',
    name: 'Fremen',
    level: 2,
    thresholds: { bgt: 100, engagement: 50, tenure: 30, activity: 50 },
  },
  {
    id: 'naib',
    name: 'Naib',
    level: 3,
    thresholds: { bgt: 1000, engagement: 100, tenure: 90, activity: 80 },
  },
];

// =============================================================================
// Tests
// =============================================================================

describe('ThresholdEditor', () => {
  describe('rendering', () => {
    it('should render all tier cards', () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      expect(screen.getByText('Wanderer')).toBeInTheDocument();
      expect(screen.getByText('Initiate')).toBeInTheDocument();
      expect(screen.getByText('Fremen')).toBeInTheDocument();
      expect(screen.getByText('Naib')).toBeInTheDocument();
    });

    it('should render tier levels', () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      expect(screen.getByText('Level 0')).toBeInTheDocument();
      expect(screen.getByText('Level 1')).toBeInTheDocument();
      expect(screen.getByText('Level 2')).toBeInTheDocument();
      expect(screen.getByText('Level 3')).toBeInTheDocument();
    });

    it('should render loading state', () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} isLoading />);

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
      expect(screen.queryByText('Wanderer')).not.toBeInTheDocument();
    });

    it('should render error state', () => {
      const errorMessage = 'Failed to load thresholds';
      render(
        <ThresholdEditor tiers={mockTiers} onSave={vi.fn()} error={errorMessage} />
      );

      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('should render header and publish button', () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      expect(screen.getByText('Threshold Editor')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /publish changes/i })).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should expand/collapse tier cards', async () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      // Naib (highest level) should be expanded by default
      // Click on Fremen to expand it too
      const fremenButton = screen.getByRole('button', { name: /fremen/i });
      fireEvent.click(fremenButton);

      // Should show threshold sliders when expanded
      await waitFor(() => {
        expect(screen.getAllByLabelText(/threshold slider/i).length).toBeGreaterThan(0);
      });
    });

    it('should toggle input mode between slider and number', async () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      // Naib is already expanded by default, find its toggle button
      const toggleButton = screen.getAllByLabelText(/switch to number input/i)[0];
      fireEvent.click(toggleButton);

      // Should now have a number input
      const numberInput = screen.getByLabelText(/threshold input/i);
      expect(numberInput).toBeInTheDocument();
    });

    it('should update threshold value via slider', async () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      // Naib is already expanded by default (first in sorted order)
      // Find its BGT slider (only one tier is expanded)
      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '2000' } });

      // Should show unsaved changes indicator
      await waitFor(() => {
        expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
      });
    });

    it('should enable publish button when dirty', async () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      const publishButton = screen.getByRole('button', { name: /publish changes/i });
      expect(publishButton).toBeDisabled();

      // Naib is already expanded by default
      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '2000' } });

      await waitFor(() => {
        expect(publishButton).not.toBeDisabled();
      });
    });

    it('should discard changes when clicking discard', async () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      // Naib is already expanded by default
      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '2000' } });

      await waitFor(() => {
        expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
      });

      // Click discard
      const discardButton = screen.getByRole('button', { name: /discard/i });
      fireEvent.click(discardButton);

      // Should no longer show unsaved changes
      await waitFor(() => {
        expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('validation', () => {
    it('should show validation error when tier ordering is violated', async () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      // Close the default-expanded Naib card first
      const naibCard = screen.getByRole('button', { name: /naib/i });
      fireEvent.click(naibCard);

      // Expand Initiate tier (level 1)
      const initiateCard = screen.getByRole('button', { name: /initiate/i });
      fireEvent.click(initiateCard);

      // Set BGT higher than Fremen (level 2) which has 100
      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '500' } });

      // Should show validation error
      await waitFor(() => {
        expect(screen.getByText(/validation errors/i)).toBeInTheDocument();
      });
    });

    it('should disable publish when validation errors exist', async () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      // Close the default-expanded Naib card first
      const naibCard = screen.getByRole('button', { name: /naib/i });
      fireEvent.click(naibCard);

      // Expand and make invalid change
      const initiateCard = screen.getByRole('button', { name: /initiate/i });
      fireEvent.click(initiateCard);

      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '500' } });

      // Publish button should be disabled
      await waitFor(() => {
        const publishButton = screen.getByRole('button', { name: /publish changes/i });
        expect(publishButton).toBeDisabled();
      });
    });
  });

  describe('publishing', () => {
    it('should call onSave when publishing', async () => {
      const onSave = vi.fn().mockResolvedValue(mockTiers);
      render(<ThresholdEditor tiers={mockTiers} onSave={onSave} />);

      // Naib is already expanded by default
      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '2000' } });

      // Click publish
      const publishButton = screen.getByRole('button', { name: /publish changes/i });
      fireEvent.click(publishButton);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });
    });

    it('should show error when publish fails', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));
      render(<ThresholdEditor tiers={mockTiers} onSave={onSave} />);

      // Naib is already expanded by default
      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '2000' } });

      // Click publish
      const publishButton = screen.getByRole('button', { name: /publish changes/i });
      fireEvent.click(publishButton);

      // Should show error message
      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });
    });
  });

  describe('impact preview', () => {
    it('should show impact preview when calculateImpact is provided', async () => {
      const calculateImpact = vi.fn().mockReturnValue({
        estimatedUsersAffected: 25,
        usersGainingAccess: 15,
        usersLosingAccess: 10,
        affectedTiers: ['Fremen', 'Naib'],
      } as ImpactPreview);

      render(
        <ThresholdEditor
          tiers={mockTiers}
          onSave={vi.fn()}
          calculateImpact={calculateImpact}
        />
      );

      // Naib is already expanded by default
      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '2000' } });

      // Should show impact preview
      await waitFor(() => {
        expect(screen.getByText('Impact Preview')).toBeInTheDocument();
        expect(screen.getByText('25')).toBeInTheDocument();
        expect(screen.getByText('+15')).toBeInTheDocument();
        expect(screen.getByText('-10')).toBeInTheDocument();
      });
    });

    it('should show high impact warning when threshold exceeded', async () => {
      const calculateImpact = vi.fn().mockReturnValue({
        estimatedUsersAffected: 50,
        usersGainingAccess: 30,
        usersLosingAccess: 20,
        affectedTiers: ['Fremen'],
      } as ImpactPreview);

      render(
        <ThresholdEditor
          tiers={mockTiers}
          onSave={vi.fn()}
          calculateImpact={calculateImpact}
        />
      );

      // Naib is already expanded by default
      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '2000' } });

      // Should show HIGH IMPACT warning
      await waitFor(() => {
        expect(screen.getByText('HIGH IMPACT')).toBeInTheDocument();
      });
    });
  });

  describe('accessibility', () => {
    it('should have accessible slider labels', () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      // Naib is already expanded by default
      // Check for accessible slider labels
      expect(screen.getByLabelText(/bgt holdings threshold slider/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/engagement score threshold slider/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/tenure threshold slider/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/activity score threshold slider/i)).toBeInTheDocument();
    });

    it('should have aria-expanded on tier cards', () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      const tierButtons = screen.getAllByRole('button').filter(
        (btn) => btn.getAttribute('aria-expanded') !== null
      );

      expect(tierButtons.length).toBeGreaterThan(0);
    });

    it('should have role="alert" on error messages', async () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} />);

      // Close the default-expanded Naib card first
      const naibCard = screen.getByRole('button', { name: /naib/i });
      fireEvent.click(naibCard);

      // Create validation error by expanding Initiate
      const initiateCard = screen.getByRole('button', { name: /initiate/i });
      fireEvent.click(initiateCard);

      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      fireEvent.change(slider, { target: { value: '500' } });

      await waitFor(() => {
        const alerts = screen.getAllByRole('alert');
        expect(alerts.length).toBeGreaterThan(0);
      });
    });
  });

  describe('disabled state', () => {
    it('should disable all controls when disabled prop is true', () => {
      render(<ThresholdEditor tiers={mockTiers} onSave={vi.fn()} disabled />);

      // Naib is already expanded by default
      // Slider should be disabled
      const slider = screen.getByLabelText(/bgt holdings threshold slider/i);
      expect(slider).toBeDisabled();

      // Publish button should be disabled
      expect(screen.getByRole('button', { name: /publish changes/i })).toBeDisabled();
    });
  });
});
