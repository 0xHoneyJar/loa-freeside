/**
 * Timeline Component Tests
 *
 * Sprint 130: Role Mapping & History
 *
 * Tests for history timeline functionality.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Timeline, type HistoryEntry, type ChangeType } from './Timeline';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockUser1 = { id: 'user-1', name: 'Alice Admin', avatar: 'https://example.com/alice.png' };
const mockUser2 = { id: 'user-2', name: 'Bob Builder' };

const mockEntries: HistoryEntry[] = [
  {
    id: 'entry-1',
    timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    type: 'threshold',
    title: 'Updated BGT threshold',
    description: 'Changed Naib BGT threshold from 1000 to 1500',
    user: mockUser1,
    snapshotId: 'snapshot-1',
  },
  {
    id: 'entry-2',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    type: 'feature',
    title: 'Enabled Custom Emojis',
    description: 'Custom Emojis now available for Fremen tier',
    user: mockUser2,
    snapshotId: 'snapshot-2',
  },
  {
    id: 'entry-3',
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    type: 'role',
    title: 'Added Admin mapping',
    description: 'Mapped Admin role to Naib tier',
    user: mockUser1,
  },
  {
    id: 'entry-4',
    timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
    type: 'restore',
    title: 'Restored configuration',
    description: 'Restored from backup taken on Jan 1',
    user: mockUser2,
    snapshotId: 'snapshot-3',
  },
];

// =============================================================================
// Tests
// =============================================================================

describe('Timeline', () => {
  describe('rendering', () => {
    it('should render all entries', () => {
      render(<Timeline entries={mockEntries} />);

      expect(screen.getByText('Updated BGT threshold')).toBeInTheDocument();
      expect(screen.getByText('Enabled Custom Emojis')).toBeInTheDocument();
      expect(screen.getByText('Added Admin mapping')).toBeInTheDocument();
      expect(screen.getByText('Restored configuration')).toBeInTheDocument();
    });

    it('should render entry descriptions', () => {
      render(<Timeline entries={mockEntries} />);

      expect(screen.getByText(/Changed Naib BGT threshold/)).toBeInTheDocument();
      expect(screen.getByText(/Custom Emojis now available/)).toBeInTheDocument();
    });

    it('should render change type badges', () => {
      render(<Timeline entries={mockEntries} />);

      // Type labels appear in both dropdown and badges, use getAllByText
      expect(screen.getAllByText('Threshold').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Feature').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Role').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Restore').length).toBeGreaterThanOrEqual(1);
    });

    it('should render user names', () => {
      render(<Timeline entries={mockEntries} />);

      expect(screen.getAllByText('Alice Admin').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Bob Builder').length).toBeGreaterThan(0);
    });

    it('should render relative timestamps', () => {
      render(<Timeline entries={mockEntries} />);

      expect(screen.getByText('5m ago')).toBeInTheDocument();
      expect(screen.getByText('2h ago')).toBeInTheDocument();
      expect(screen.getByText('3d ago')).toBeInTheDocument();
    });

    it('should render loading state', () => {
      render(<Timeline entries={mockEntries} isLoading />);

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should render error state', () => {
      render(<Timeline entries={mockEntries} error="Failed to load history" />);

      expect(screen.getByText('Failed to load history')).toBeInTheDocument();
    });

    it('should render empty state', () => {
      render(<Timeline entries={[]} />);

      expect(screen.getByText('No history entries found')).toBeInTheDocument();
    });

    it('should render entry count', () => {
      render(<Timeline entries={mockEntries} />);

      expect(screen.getByText('4 changes')).toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    it('should filter by change type', () => {
      render(<Timeline entries={mockEntries} />);

      const typeFilter = screen.getByLabelText(/filter by change type/i);
      fireEvent.change(typeFilter, { target: { value: 'threshold' } });

      expect(screen.getByText('Updated BGT threshold')).toBeInTheDocument();
      expect(screen.queryByText('Enabled Custom Emojis')).not.toBeInTheDocument();
      expect(screen.getByText('1 change')).toBeInTheDocument();
    });

    it('should filter by user', () => {
      render(<Timeline entries={mockEntries} />);

      const userFilter = screen.getByLabelText(/filter by user/i);
      fireEvent.change(userFilter, { target: { value: 'user-1' } });

      expect(screen.getByText('Updated BGT threshold')).toBeInTheDocument();
      expect(screen.getByText('Added Admin mapping')).toBeInTheDocument();
      expect(screen.queryByText('Enabled Custom Emojis')).not.toBeInTheDocument();
      expect(screen.getByText('2 changes')).toBeInTheDocument();
    });

    it('should combine type and user filters', () => {
      render(<Timeline entries={mockEntries} />);

      // Filter by type
      const typeFilter = screen.getByLabelText(/filter by change type/i);
      fireEvent.change(typeFilter, { target: { value: 'threshold' } });

      // Filter by user
      const userFilter = screen.getByLabelText(/filter by user/i);
      fireEvent.change(userFilter, { target: { value: 'user-1' } });

      expect(screen.getByText('Updated BGT threshold')).toBeInTheDocument();
      expect(screen.getByText('1 change')).toBeInTheDocument();
    });

    it('should show all entries when filters cleared', () => {
      render(<Timeline entries={mockEntries} />);

      // Apply filter
      const typeFilter = screen.getByLabelText(/filter by change type/i);
      fireEvent.change(typeFilter, { target: { value: 'threshold' } });
      expect(screen.getByText('1 change')).toBeInTheDocument();

      // Clear filter
      fireEvent.change(typeFilter, { target: { value: '' } });
      expect(screen.getByText('4 changes')).toBeInTheDocument();
    });
  });

  describe('actions', () => {
    it('should render View Diff button for entries with snapshots', () => {
      const onSelectForDiff = vi.fn();
      render(<Timeline entries={mockEntries} onSelectForDiff={onSelectForDiff} />);

      const viewDiffButtons = screen.getAllByText('View Diff');
      expect(viewDiffButtons.length).toBe(3); // 3 entries have snapshots
    });

    it('should call onSelectForDiff when clicking View Diff', () => {
      const onSelectForDiff = vi.fn();
      render(<Timeline entries={mockEntries} onSelectForDiff={onSelectForDiff} />);

      const viewDiffButtons = screen.getAllByText('View Diff');
      fireEvent.click(viewDiffButtons[0]);

      expect(onSelectForDiff).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'entry-1' })
      );
    });

    it('should render Restore button when onSelectForRestore provided', () => {
      const onSelectForRestore = vi.fn();
      render(<Timeline entries={mockEntries} onSelectForRestore={onSelectForRestore} />);

      // Filter to only action buttons (not the dropdown option or badge)
      const restoreButtons = screen.getAllByRole('button', { name: /restore/i });
      expect(restoreButtons.length).toBe(3); // 3 entries have snapshots
    });

    it('should call onSelectForRestore when clicking Restore', () => {
      const onSelectForRestore = vi.fn();
      render(<Timeline entries={mockEntries} onSelectForRestore={onSelectForRestore} />);

      const restoreButtons = screen.getAllByRole('button', { name: /restore/i });
      fireEvent.click(restoreButtons[0]);

      expect(onSelectForRestore).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'entry-1' })
      );
    });

    it('should not render action buttons for entries without snapshots', () => {
      const onSelectForDiff = vi.fn();
      render(
        <Timeline
          entries={[mockEntries[2]]} // entry-3 has no snapshotId
          onSelectForDiff={onSelectForDiff}
        />
      );

      expect(screen.queryByText('View Diff')).not.toBeInTheDocument();
    });
  });

  describe('user avatars', () => {
    it('should render user avatar when available', () => {
      render(<Timeline entries={mockEntries} />);

      const avatar = document.querySelector('img[alt="Alice Admin"]');
      expect(avatar).toBeInTheDocument();
    });

    it('should render initial when avatar not available', () => {
      render(<Timeline entries={[mockEntries[1]]} />); // Bob Builder has no avatar

      const initial = screen.getByText('B');
      expect(initial).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('should sort entries by timestamp (newest first)', () => {
      render(<Timeline entries={mockEntries} />);

      const titles = screen.getAllByRole('heading', { level: 3 });
      expect(titles[0]).toHaveTextContent('Updated BGT threshold'); // 5 min ago
      expect(titles[1]).toHaveTextContent('Enabled Custom Emojis'); // 2 hours ago
      expect(titles[2]).toHaveTextContent('Added Admin mapping'); // 3 days ago
      expect(titles[3]).toHaveTextContent('Restored configuration'); // 10 days ago
    });
  });
});
