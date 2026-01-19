/**
 * RestoreModal Component Tests
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Tests for restore modal functionality.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RestoreModal, type RestoreImpact, type RestoreTarget } from './RestoreModal';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockTarget: RestoreTarget = {
  id: 'snapshot-1',
  label: 'January Backup',
  timestamp: new Date('2025-01-01T10:00:00'),
  createdBy: 'Alice Admin',
};

const lowImpact: RestoreImpact = {
  usersAffected: 10,
  changes: {
    thresholds: 1,
    features: 0,
    roles: 0,
    tiers: 0,
  },
  warnings: [],
  isHighImpact: false,
};

const highImpact: RestoreImpact = {
  usersAffected: 500,
  changes: {
    thresholds: 3,
    features: 5,
    roles: 2,
    tiers: 1,
  },
  warnings: [
    'This will affect active feature gates',
    'Role mappings will be reset',
  ],
  isHighImpact: true,
};

// =============================================================================
// Tests
// =============================================================================

describe('RestoreModal', () => {
  describe('rendering', () => {
    it('should not render when closed', () => {
      render(
        <RestoreModal
          isOpen={false}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.queryByText('Restore Configuration')).not.toBeInTheDocument();
    });

    it('should render when open', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.getByText('Restore Configuration')).toBeInTheDocument();
    });

    it('should render target info', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.getByText('January Backup')).toBeInTheDocument();
      expect(screen.getByText(/by Alice Admin/)).toBeInTheDocument();
    });

    it('should render impact summary', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.getByText('10')).toBeInTheDocument(); // Users affected
      expect(screen.getByText('Users Affected')).toBeInTheDocument();
      // "1" appears multiple times (total changes and threshold count), use getAllByText
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1); // Total changes
      expect(screen.getByText('Total Changes')).toBeInTheDocument();
    });

    it('should render change breakdown', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={highImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.getByText('Thresholds')).toBeInTheDocument();
      expect(screen.getByText('Features')).toBeInTheDocument();
      expect(screen.getByText('Roles')).toBeInTheDocument();
      expect(screen.getByText('Tiers')).toBeInTheDocument();
    });

    it('should have accessible dialog attributes', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
        />
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'restore-modal-title');
    });
  });

  describe('warnings', () => {
    it('should render warnings when present', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={highImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.getByText('Warnings')).toBeInTheDocument();
      expect(screen.getByText('This will affect active feature gates')).toBeInTheDocument();
      expect(screen.getByText('Role mappings will be reset')).toBeInTheDocument();
    });

    it('should not render warnings section when empty', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.queryByText('Warnings')).not.toBeInTheDocument();
    });
  });

  describe('high impact confirmation', () => {
    it('should show confirmation checkbox for high impact', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={highImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.getByLabelText(/high-impact restore/i)).toBeInTheDocument();
    });

    it('should not show confirmation checkbox for low impact', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.queryByLabelText(/high-impact restore/i)).not.toBeInTheDocument();
    });

    it('should disable restore button until confirmed for high impact', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={highImpact}
          onConfirm={vi.fn()}
        />
      );

      const restoreButton = screen.getByRole('button', { name: 'Restore' });
      expect(restoreButton).toBeDisabled();
    });

    it('should enable restore button after confirmation', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={highImpact}
          onConfirm={vi.fn()}
        />
      );

      const checkbox = screen.getByLabelText(/high-impact restore/i);
      fireEvent.click(checkbox);

      const restoreButton = screen.getByRole('button', { name: 'Restore' });
      expect(restoreButton).not.toBeDisabled();
    });

    it('should show impact numbers in confirmation text', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={highImpact}
          onConfirm={vi.fn()}
        />
      );

      expect(screen.getByText(/affects 500 users/i)).toBeInTheDocument();
      expect(screen.getByText(/11 changes/i)).toBeInTheDocument(); // 3+5+2+1=11
    });
  });

  describe('actions', () => {
    it('should call onClose when clicking Cancel', () => {
      const onClose = vi.fn();
      render(
        <RestoreModal
          isOpen={true}
          onClose={onClose}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalled();
    });

    it('should call onConfirm when clicking Restore', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={onConfirm}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalled();
      });
    });

    it('should close modal after successful restore', async () => {
      const onClose = vi.fn();
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(
        <RestoreModal
          isOpen={true}
          onClose={onClose}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={onConfirm}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('should show error on restore failure', async () => {
      const onConfirm = vi.fn().mockRejectedValue(new Error('Network error'));
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={onConfirm}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should show default error message for non-Error rejection', async () => {
      const onConfirm = vi.fn().mockRejectedValue('unknown');
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={onConfirm}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

      await waitFor(() => {
        expect(screen.getByText('Restore failed')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('should show loading spinner', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
          isLoading
        />
      );

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should disable buttons while loading', () => {
      render(
        <RestoreModal
          isOpen={true}
          onClose={vi.fn()}
          target={mockTarget}
          impact={lowImpact}
          onConfirm={vi.fn()}
          isLoading
        />
      );

      expect(screen.getByText('Cancel')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    });
  });
});
