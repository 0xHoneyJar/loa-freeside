/**
 * Permission Result Component
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Displays list of granted/denied permissions based on user state.
 *
 * @module components/sandbox/PermissionResult
 */

import React, { useMemo } from 'react';

// =============================================================================
// Types
// =============================================================================

export type PermissionStatus = 'granted' | 'denied' | 'partial';

export interface PermissionCheck {
  /** Permission/feature identifier */
  id: string;
  /** Display name */
  name: string;
  /** Category (channels, features, commands) */
  category: string;
  /** Whether permission is granted */
  status: PermissionStatus;
  /** Reason for the status */
  reason: string;
  /** Required tier for this permission */
  requiredTier?: string;
  /** Current user's effective tier */
  userTier?: string;
}

export interface PermissionResultProps {
  /** List of permission checks */
  permissions: PermissionCheck[];
  /** Currently selected permission for detail view */
  selected?: string;
  /** Callback when a permission is selected */
  onSelect?: (id: string) => void;
  /** Show only granted, denied, or all */
  filter?: 'all' | 'granted' | 'denied';
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

function getStatusIcon(status: PermissionStatus): React.ReactNode {
  switch (status) {
    case 'granted':
      return (
        <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'denied':
      return (
        <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    case 'partial':
      return (
        <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
  }
}

function getStatusColor(status: PermissionStatus): string {
  switch (status) {
    case 'granted':
      return 'border-green-500/30 bg-green-900/10';
    case 'denied':
      return 'border-red-500/30 bg-red-900/10';
    case 'partial':
      return 'border-yellow-500/30 bg-yellow-900/10';
  }
}

function getStatusLabel(status: PermissionStatus): string {
  switch (status) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied';
    case 'partial':
      return 'Partial';
  }
}

// =============================================================================
// Main Component
// =============================================================================

export const PermissionResult: React.FC<PermissionResultProps> = ({
  permissions,
  selected,
  onSelect,
  filter = 'all',
  isLoading = false,
  error,
}) => {
  // Group permissions by category
  const groupedPermissions = useMemo(() => {
    const filtered = filter === 'all'
      ? permissions
      : permissions.filter((p) => p.status === filter);

    const groups: Record<string, PermissionCheck[]> = {};
    for (const perm of filtered) {
      if (!groups[perm.category]) {
        groups[perm.category] = [];
      }
      groups[perm.category].push(perm);
    }
    return groups;
  }, [permissions, filter]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const granted = permissions.filter((p) => p.status === 'granted').length;
    const denied = permissions.filter((p) => p.status === 'denied').length;
    const partial = permissions.filter((p) => p.status === 'partial').length;
    return { granted, denied, partial, total: permissions.length };
  }, [permissions]);

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4" role="alert">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <svg
          className="animate-spin h-8 w-8 text-amber-500"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-green-400">{stats.granted}</p>
          <p className="text-xs text-gray-500">Granted</p>
        </div>
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-red-400">{stats.denied}</p>
          <p className="text-xs text-gray-500">Denied</p>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-yellow-400">{stats.partial}</p>
          <p className="text-xs text-gray-500">Partial</p>
        </div>
      </div>

      {/* Empty State */}
      {permissions.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <svg
            className="mx-auto h-12 w-12 text-gray-600 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <p>No permissions to display</p>
          <p className="text-sm mt-1">Run a permission check to see results</p>
        </div>
      )}

      {/* Permission Groups */}
      {Object.entries(groupedPermissions).map(([category, perms]) => (
        <div key={category} className="bg-gray-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-gray-900/50 border-b border-gray-700">
            <h3 className="font-medium text-white capitalize">{category}</h3>
            <p className="text-xs text-gray-500">
              {perms.filter((p) => p.status === 'granted').length} / {perms.length} granted
            </p>
          </div>
          <ul className="divide-y divide-gray-700">
            {perms.map((perm) => (
              <li
                key={perm.id}
                className={`px-4 py-3 cursor-pointer transition-colors ${
                  selected === perm.id ? 'bg-gray-700' : 'hover:bg-gray-700/50'
                }`}
                onClick={() => onSelect?.(perm.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect?.(perm.id);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(perm.status)}
                    <div>
                      <p className="font-medium text-white">{perm.name}</p>
                      <p className="text-sm text-gray-500">{perm.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {perm.requiredTier && (
                      <span className="text-xs px-2 py-1 rounded bg-gray-900 text-gray-400">
                        Requires: {perm.requiredTier}
                      </span>
                    )}
                    <span
                      className={`text-xs px-2 py-1 rounded border ${getStatusColor(perm.status)}`}
                    >
                      {getStatusLabel(perm.status)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Filter notice */}
      {filter !== 'all' && Object.keys(groupedPermissions).length === 0 && permissions.length > 0 && (
        <div className="text-center py-4 text-gray-500">
          <p>No {filter} permissions found</p>
        </div>
      )}
    </div>
  );
};

export default PermissionResult;
