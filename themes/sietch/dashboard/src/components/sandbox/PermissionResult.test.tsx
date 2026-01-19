/**
 * PermissionResult Component Tests
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Tests for permission result display functionality.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PermissionResult, type PermissionCheck } from './PermissionResult';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockPermissions: PermissionCheck[] = [
  {
    id: 'perm-1',
    name: 'General Chat',
    category: 'channels',
    status: 'granted',
    reason: 'Available to all tiers',
    requiredTier: 'wanderer',
    userTier: 'fremen',
  },
  {
    id: 'perm-2',
    name: 'Trading Discussion',
    category: 'channels',
    status: 'granted',
    reason: 'Fremen tier has access',
    requiredTier: 'fremen',
    userTier: 'fremen',
  },
  {
    id: 'perm-3',
    name: 'Alpha Signals',
    category: 'channels',
    status: 'denied',
    reason: 'Requires Naib tier',
    requiredTier: 'naib',
    userTier: 'fremen',
  },
  {
    id: 'perm-4',
    name: 'Custom Emojis',
    category: 'features',
    status: 'granted',
    reason: 'Tier requirement met',
    requiredTier: 'initiate',
    userTier: 'fremen',
  },
  {
    id: 'perm-5',
    name: 'Admin Commands',
    category: 'commands',
    status: 'denied',
    reason: 'Requires Naib tier',
    requiredTier: 'naib',
    userTier: 'fremen',
  },
  {
    id: 'perm-6',
    name: 'Giveaway Access',
    category: 'features',
    status: 'partial',
    reason: 'Limited access via badge',
    requiredTier: 'naib',
    userTier: 'fremen',
  },
];

// =============================================================================
// Tests
// =============================================================================

describe('PermissionResult', () => {
  describe('rendering', () => {
    it('should render all permissions grouped by category', () => {
      render(<PermissionResult permissions={mockPermissions} />);

      // Categories
      expect(screen.getByText('channels')).toBeInTheDocument();
      expect(screen.getByText('features')).toBeInTheDocument();
      expect(screen.getByText('commands')).toBeInTheDocument();

      // Permissions
      expect(screen.getByText('General Chat')).toBeInTheDocument();
      expect(screen.getByText('Trading Discussion')).toBeInTheDocument();
      expect(screen.getByText('Alpha Signals')).toBeInTheDocument();
      expect(screen.getByText('Custom Emojis')).toBeInTheDocument();
      expect(screen.getByText('Admin Commands')).toBeInTheDocument();
    });

    it('should render summary stats', () => {
      render(<PermissionResult permissions={mockPermissions} />);

      // 3 granted, 2 denied, 1 partial
      const grantedStat = screen.getByText('3');
      expect(grantedStat.closest('div')).toHaveClass('bg-green-900/20');

      const deniedStat = screen.getByText('2');
      expect(deniedStat.closest('div')).toHaveClass('bg-red-900/20');

      const partialStat = screen.getByText('1');
      expect(partialStat.closest('div')).toHaveClass('bg-yellow-900/20');
    });

    it('should render permission reasons', () => {
      render(<PermissionResult permissions={mockPermissions} />);

      expect(screen.getByText('Available to all tiers')).toBeInTheDocument();
      // Multiple permissions have "Requires Naib tier" as reason
      expect(screen.getAllByText('Requires Naib tier').length).toBeGreaterThanOrEqual(1);
    });

    it('should render required tier labels', () => {
      render(<PermissionResult permissions={mockPermissions} />);

      expect(screen.getAllByText(/Requires: naib/)).toHaveLength(3);
    });

    it('should render loading state', () => {
      render(<PermissionResult permissions={[]} isLoading />);

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should render error state', () => {
      render(<PermissionResult permissions={[]} error="Failed to load permissions" />);

      expect(screen.getByText('Failed to load permissions')).toBeInTheDocument();
    });

    it('should render empty state', () => {
      render(<PermissionResult permissions={[]} />);

      expect(screen.getByText('No permissions to display')).toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    it('should filter to show only granted permissions', () => {
      render(<PermissionResult permissions={mockPermissions} filter="granted" />);

      expect(screen.getByText('General Chat')).toBeInTheDocument();
      expect(screen.getByText('Trading Discussion')).toBeInTheDocument();
      expect(screen.getByText('Custom Emojis')).toBeInTheDocument();
      expect(screen.queryByText('Alpha Signals')).not.toBeInTheDocument();
      expect(screen.queryByText('Admin Commands')).not.toBeInTheDocument();
    });

    it('should filter to show only denied permissions', () => {
      render(<PermissionResult permissions={mockPermissions} filter="denied" />);

      expect(screen.getByText('Alpha Signals')).toBeInTheDocument();
      expect(screen.getByText('Admin Commands')).toBeInTheDocument();
      expect(screen.queryByText('General Chat')).not.toBeInTheDocument();
      expect(screen.queryByText('Custom Emojis')).not.toBeInTheDocument();
    });

    it('should show filter notice when no results', () => {
      const grantedOnly: PermissionCheck[] = mockPermissions.filter(
        (p) => p.status === 'granted'
      );
      render(<PermissionResult permissions={grantedOnly} filter="denied" />);

      expect(screen.getByText('No denied permissions found')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('should call onSelect when clicking a permission', () => {
      const onSelect = vi.fn();
      render(<PermissionResult permissions={mockPermissions} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('General Chat'));

      expect(onSelect).toHaveBeenCalledWith('perm-1');
    });

    it('should highlight selected permission', () => {
      render(
        <PermissionResult
          permissions={mockPermissions}
          selected="perm-1"
          onSelect={vi.fn()}
        />
      );

      const generalChatItem = screen.getByText('General Chat').closest('li');
      expect(generalChatItem).toHaveClass('bg-gray-700');
    });

    it('should support keyboard selection', () => {
      const onSelect = vi.fn();
      render(<PermissionResult permissions={mockPermissions} onSelect={onSelect} />);

      const item = screen.getByText('General Chat').closest('li');
      fireEvent.keyDown(item!, { key: 'Enter' });

      expect(onSelect).toHaveBeenCalledWith('perm-1');
    });

    it('should support space key selection', () => {
      const onSelect = vi.fn();
      render(<PermissionResult permissions={mockPermissions} onSelect={onSelect} />);

      const item = screen.getByText('General Chat').closest('li');
      fireEvent.keyDown(item!, { key: ' ' });

      expect(onSelect).toHaveBeenCalledWith('perm-1');
    });
  });

  describe('status badges', () => {
    it('should show Granted badge for granted permissions', () => {
      render(<PermissionResult permissions={mockPermissions} />);

      // "Granted" appears in badges (3) + stats summary (1) = 4
      const grantedBadges = screen.getAllByText('Granted');
      expect(grantedBadges.length).toBeGreaterThanOrEqual(3);
    });

    it('should show Denied badge for denied permissions', () => {
      render(<PermissionResult permissions={mockPermissions} />);

      // "Denied" appears in badges (2) + stats summary (1) = 3
      const deniedBadges = screen.getAllByText('Denied');
      expect(deniedBadges.length).toBeGreaterThanOrEqual(2);
    });

    it('should show Partial badge for partial permissions', () => {
      render(<PermissionResult permissions={mockPermissions} />);

      // "Partial" appears in badge and summary stats
      expect(screen.getAllByText('Partial').length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('category grouping', () => {
    it('should show permission count per category', () => {
      render(<PermissionResult permissions={mockPermissions} />);

      // channels: 2 granted out of 3
      expect(screen.getByText('2 / 3 granted')).toBeInTheDocument();
    });
  });
});
