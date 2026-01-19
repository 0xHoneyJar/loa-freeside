/**
 * DiffViewer Component Tests
 *
 * Sprint 130: Role Mapping & History
 *
 * Tests for diff viewer functionality.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffViewer, type ConfigSnapshot } from './DiffViewer';

// =============================================================================
// Test Fixtures
// =============================================================================

const leftSnapshot: ConfigSnapshot = {
  id: 'snapshot-1',
  timestamp: new Date('2025-01-01T10:00:00'),
  label: 'January Backup',
  data: {
    tiers: {
      naib: { bgt: 1000, engagement: 80 },
      fremen: { bgt: 100, engagement: 50 },
    },
    features: {
      customEmoji: false,
      voiceChat: true,
    },
  },
};

const rightSnapshot: ConfigSnapshot = {
  id: 'snapshot-2',
  timestamp: new Date('2025-01-15T14:30:00'),
  label: 'Current',
  data: {
    tiers: {
      naib: { bgt: 1500, engagement: 80 }, // bgt changed
      fremen: { bgt: 100, engagement: 60 }, // engagement changed
    },
    features: {
      customEmoji: true, // changed to true
      voiceChat: true,
      adminPanel: true, // added
    },
  },
};

const identicalSnapshot: ConfigSnapshot = {
  id: 'snapshot-3',
  timestamp: new Date('2025-01-15T14:30:00'),
  label: 'Identical',
  data: { ...leftSnapshot.data },
};

// =============================================================================
// Tests
// =============================================================================

describe('DiffViewer', () => {
  describe('rendering', () => {
    it('should render version labels', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      expect(screen.getByText('January Backup')).toBeInTheDocument();
      expect(screen.getByText('Current')).toBeInTheDocument();
    });

    it('should render timestamps', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      // Check for formatted dates
      expect(screen.getByText(/Jan 1, 2025/)).toBeInTheDocument();
      expect(screen.getByText(/Jan 15, 2025/)).toBeInTheDocument();
    });

    it('should render Before/After badges', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      expect(screen.getByText('Before')).toBeInTheDocument();
      expect(screen.getByText('After')).toBeInTheDocument();
    });

    it('should render title when provided', () => {
      render(
        <DiffViewer
          left={leftSnapshot}
          right={rightSnapshot}
          title="Configuration Changes"
        />
      );

      expect(screen.getByText('Configuration Changes')).toBeInTheDocument();
    });
  });

  describe('diff statistics', () => {
    it('should show added count', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      // features.adminPanel was added
      expect(screen.getByText(/\+1 added/)).toBeInTheDocument();
    });

    it('should show modified count', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      // tiers.naib.bgt, tiers.fremen.engagement, features.customEmoji changed
      expect(screen.getByText(/~3 modified/)).toBeInTheDocument();
    });

    it('should show no differences message when identical', () => {
      render(<DiffViewer left={leftSnapshot} right={identicalSnapshot} />);

      expect(screen.getByText('No differences found')).toBeInTheDocument();
    });
  });

  describe('diff lines', () => {
    it('should render added lines with + marker', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      // Look for the added marker
      const addedMarkers = screen.getAllByText('+');
      expect(addedMarkers.length).toBeGreaterThan(0);
    });

    it('should render modified lines with ~ marker', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      const modifiedMarkers = screen.getAllByText('~');
      expect(modifiedMarkers.length).toBeGreaterThan(0);
    });

    it('should show path names', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      expect(screen.getAllByText(/tiers\.naib\.bgt/).length).toBeGreaterThan(0);
    });

    it('should show old and new values', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      // Check for the actual values
      expect(screen.getByText('1000')).toBeInTheDocument();
      expect(screen.getByText('1500')).toBeInTheDocument();
    });
  });

  describe('removed lines', () => {
    it('should render removed lines with - marker', () => {
      // Create snapshots where something was removed
      const withRemoved: ConfigSnapshot = {
        id: 'snapshot-removed',
        timestamp: new Date(),
        data: {
          features: {
            voiceChat: true,
          },
        },
      };
      const afterRemoval: ConfigSnapshot = {
        id: 'snapshot-after',
        timestamp: new Date(),
        data: {
          features: {},
        },
      };

      render(<DiffViewer left={withRemoved} right={afterRemoval} />);

      const removedMarkers = screen.getAllByText('-');
      expect(removedMarkers.length).toBeGreaterThan(0);
      expect(screen.getByText(/\-1 removed/)).toBeInTheDocument();
    });
  });

  describe('unchanged lines', () => {
    it('should hide unchanged lines by default', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      // tiers.fremen.bgt is unchanged (100)
      // We shouldn't see "unchanged" in the stats by default
      expect(screen.queryByText(/unchanged/)).not.toBeInTheDocument();
    });

    it('should show unchanged lines when showUnchanged is true', () => {
      render(
        <DiffViewer
          left={leftSnapshot}
          right={rightSnapshot}
          showUnchanged
        />
      );

      expect(screen.getByText(/unchanged/)).toBeInTheDocument();
    });
  });

  describe('restore action', () => {
    it('should render restore button when onRestore provided', () => {
      const onRestore = vi.fn();
      render(
        <DiffViewer
          left={leftSnapshot}
          right={rightSnapshot}
          onRestore={onRestore}
        />
      );

      expect(screen.getByText('Restore to Left')).toBeInTheDocument();
    });

    it('should call onRestore with left snapshot when clicked', () => {
      const onRestore = vi.fn();
      render(
        <DiffViewer
          left={leftSnapshot}
          right={rightSnapshot}
          onRestore={onRestore}
        />
      );

      fireEvent.click(screen.getByText('Restore to Left'));

      expect(onRestore).toHaveBeenCalledWith(leftSnapshot);
    });

    it('should disable restore button when no changes', () => {
      const onRestore = vi.fn();
      render(
        <DiffViewer
          left={leftSnapshot}
          right={identicalSnapshot}
          onRestore={onRestore}
        />
      );

      expect(screen.getByText('Restore to Left')).toBeDisabled();
    });

    it('should not render restore button when onRestore not provided', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      expect(screen.queryByText('Restore to Left')).not.toBeInTheDocument();
    });
  });

  describe('value formatting', () => {
    it('should format string values with quotes', () => {
      const leftWithString: ConfigSnapshot = {
        id: 'left',
        timestamp: new Date(),
        data: { name: 'old' },
      };
      const rightWithString: ConfigSnapshot = {
        id: 'right',
        timestamp: new Date(),
        data: { name: 'new' },
      };

      render(<DiffViewer left={leftWithString} right={rightWithString} />);

      expect(screen.getByText('"old"')).toBeInTheDocument();
      expect(screen.getByText('"new"')).toBeInTheDocument();
    });

    it('should format boolean values', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      // features.customEmoji changed from false to true
      expect(screen.getByText('false')).toBeInTheDocument();
    });

    it('should format null values', () => {
      const leftWithNull: ConfigSnapshot = {
        id: 'left',
        timestamp: new Date(),
        data: { value: null },
      };
      const rightWithValue: ConfigSnapshot = {
        id: 'right',
        timestamp: new Date(),
        data: { value: 'something' },
      };

      render(<DiffViewer left={leftWithNull} right={rightWithValue} />);

      expect(screen.getByText('null')).toBeInTheDocument();
    });
  });

  describe('legend', () => {
    it('should render diff legend', () => {
      render(<DiffViewer left={leftSnapshot} right={rightSnapshot} />);

      expect(screen.getByText('Added')).toBeInTheDocument();
      expect(screen.getByText('Removed')).toBeInTheDocument();
      expect(screen.getByText('Modified')).toBeInTheDocument();
    });
  });
});
