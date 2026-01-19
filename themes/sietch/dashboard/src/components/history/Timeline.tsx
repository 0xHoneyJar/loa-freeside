/**
 * History Timeline Component
 *
 * Sprint 130: Role Mapping & History
 *
 * Displays chronological list of configuration changes with filtering.
 *
 * @module components/history/Timeline
 */

import React, { useState, useMemo } from 'react';

// =============================================================================
// Types
// =============================================================================

export type ChangeType = 'threshold' | 'feature' | 'role' | 'tier' | 'restore';

export interface HistoryEntry {
  id: string;
  timestamp: Date;
  type: ChangeType;
  title: string;
  description: string;
  user: {
    id: string;
    name: string;
    avatar?: string;
  };
  /** Snapshot ID for diff/restore */
  snapshotId?: string;
  /** Metadata about the change */
  metadata?: Record<string, unknown>;
}

export interface TimelineProps {
  /** History entries to display */
  entries: HistoryEntry[];
  /** Callback when entry is selected for diff */
  onSelectForDiff?: (entry: HistoryEntry) => void;
  /** Callback when entry is selected for restore */
  onSelectForRestore?: (entry: HistoryEntry) => void;
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

const CHANGE_TYPE_CONFIG: Record<ChangeType, { label: string; color: string; icon: string }> = {
  threshold: {
    label: 'Threshold',
    color: 'bg-amber-500',
    icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01',
  },
  feature: {
    label: 'Feature',
    color: 'bg-blue-500',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
  role: {
    label: 'Role',
    color: 'bg-purple-500',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  },
  tier: {
    label: 'Tier',
    color: 'bg-green-500',
    icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  },
  restore: {
    label: 'Restore',
    color: 'bg-orange-500',
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

// =============================================================================
// Helper Components
// =============================================================================

interface TimelineEntryCardProps {
  entry: HistoryEntry;
  onSelectForDiff?: (entry: HistoryEntry) => void;
  onSelectForRestore?: (entry: HistoryEntry) => void;
}

const TimelineEntryCard: React.FC<TimelineEntryCardProps> = ({
  entry,
  onSelectForDiff,
  onSelectForRestore,
}) => {
  const config = CHANGE_TYPE_CONFIG[entry.type];

  return (
    <div className="flex gap-4">
      {/* Timeline Line & Dot */}
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full ${config.color}`} />
        <div className="w-0.5 flex-1 bg-gray-700" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              {/* Header */}
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${config.color} text-black`}>
                  {config.label}
                </span>
                <span className="text-xs text-gray-500">{formatTimestamp(entry.timestamp)}</span>
              </div>

              {/* Title & Description */}
              <h3 className="font-medium text-white">{entry.title}</h3>
              <p className="text-sm text-gray-400 mt-1">{entry.description}</p>

              {/* User */}
              <div className="flex items-center gap-2 mt-3">
                {entry.user.avatar ? (
                  <img
                    src={entry.user.avatar}
                    alt={entry.user.name}
                    className="w-5 h-5 rounded-full"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-xs text-white">
                    {entry.user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-xs text-gray-500">{entry.user.name}</span>
              </div>
            </div>

            {/* Actions */}
            {entry.snapshotId && (
              <div className="flex flex-col gap-2">
                {onSelectForDiff && (
                  <button
                    onClick={() => onSelectForDiff(entry)}
                    className="px-3 py-1.5 text-xs bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
                  >
                    View Diff
                  </button>
                )}
                {onSelectForRestore && (
                  <button
                    onClick={() => onSelectForRestore(entry)}
                    className="px-3 py-1.5 text-xs bg-amber-500 text-black rounded hover:bg-amber-400 transition-colors"
                  >
                    Restore
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const Timeline: React.FC<TimelineProps> = ({
  entries,
  onSelectForDiff,
  onSelectForRestore,
  isLoading = false,
  error,
}) => {
  const [typeFilter, setTypeFilter] = useState<ChangeType | ''>('');
  const [userFilter, setUserFilter] = useState<string>('');

  // Get unique users from entries
  const users = useMemo(() => {
    const userMap = new Map<string, { id: string; name: string }>();
    entries.forEach((e) => {
      if (!userMap.has(e.user.id)) {
        userMap.set(e.user.id, e.user);
      }
    });
    return Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return entries
      .filter((e) => !typeFilter || e.type === typeFilter)
      .filter((e) => !userFilter || e.user.id === userFilter)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [entries, typeFilter, userFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-500 rounded-lg p-4 text-center">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Filters */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Change History</h2>
          <p className="text-sm text-gray-400">
            {filteredEntries.length} change{filteredEntries.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ChangeType | '')}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
            aria-label="Filter by change type"
          >
            <option value="">All Types</option>
            {Object.entries(CHANGE_TYPE_CONFIG).map(([type, config]) => (
              <option key={type} value={type}>
                {config.label}
              </option>
            ))}
          </select>

          {/* User Filter */}
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
            aria-label="Filter by user"
          >
            <option value="">All Users</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Timeline */}
      {filteredEntries.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">No history entries found</p>
        </div>
      ) : (
        <div className="pl-2">
          {filteredEntries.map((entry) => (
            <TimelineEntryCard
              key={entry.id}
              entry={entry}
              onSelectForDiff={onSelectForDiff}
              onSelectForRestore={onSelectForRestore}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Timeline;
