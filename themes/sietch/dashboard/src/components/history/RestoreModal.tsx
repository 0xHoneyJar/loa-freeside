/**
 * Restore Modal Component
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Preview modal for configuration restore with impact analysis.
 * Requires confirmation for high-impact restores.
 *
 * @module components/history/RestoreModal
 */

import React, { useState, useMemo } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface RestoreImpact {
  /** Number of users affected by restore */
  usersAffected: number;
  /** Categories of changes */
  changes: {
    thresholds: number;
    features: number;
    roles: number;
    tiers: number;
  };
  /** Warnings about potential issues */
  warnings: string[];
  /** Whether this is considered high-impact */
  isHighImpact: boolean;
}

export interface RestoreTarget {
  id: string;
  label: string;
  timestamp: Date;
  createdBy?: string;
}

export interface RestoreModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Target snapshot to restore to */
  target: RestoreTarget;
  /** Impact analysis of the restore */
  impact: RestoreImpact;
  /** Callback to execute the restore */
  onConfirm: () => Promise<void>;
  /** Loading state */
  isLoading?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// =============================================================================
// Main Component
// =============================================================================

export const RestoreModal: React.FC<RestoreModalProps> = ({
  isOpen,
  onClose,
  target,
  impact,
  onConfirm,
  isLoading = false,
}) => {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalChanges = useMemo(
    () =>
      impact.changes.thresholds +
      impact.changes.features +
      impact.changes.roles +
      impact.changes.tiers,
    [impact.changes]
  );

  const canRestore = !impact.isHighImpact || confirmed;

  const handleConfirm = async () => {
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-modal-title"
    >
      <div className="bg-gray-900 rounded-lg shadow-xl max-w-lg w-full mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 id="restore-modal-title" className="text-xl font-bold text-white">
            Restore Configuration
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Review the impact before restoring
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Target Info */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="font-medium text-white mb-2">Restore Target</h3>
            <p className="text-amber-400">{target.label}</p>
            <p className="text-sm text-gray-500">
              {formatTimestamp(target.timestamp)}
              {target.createdBy && ` by ${target.createdBy}`}
            </p>
          </div>

          {/* Impact Summary */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="font-medium text-white mb-3">Impact Summary</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900 rounded p-3">
                <p className="text-2xl font-bold text-white">{impact.usersAffected}</p>
                <p className="text-xs text-gray-500">Users Affected</p>
              </div>
              <div className="bg-gray-900 rounded p-3">
                <p className="text-2xl font-bold text-white">{totalChanges}</p>
                <p className="text-xs text-gray-500">Total Changes</p>
              </div>
            </div>

            {/* Change Breakdown */}
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
              <div>
                <p className="text-amber-400 font-medium">{impact.changes.thresholds}</p>
                <p className="text-gray-500">Thresholds</p>
              </div>
              <div>
                <p className="text-blue-400 font-medium">{impact.changes.features}</p>
                <p className="text-gray-500">Features</p>
              </div>
              <div>
                <p className="text-purple-400 font-medium">{impact.changes.roles}</p>
                <p className="text-gray-500">Roles</p>
              </div>
              <div>
                <p className="text-green-400 font-medium">{impact.changes.tiers}</p>
                <p className="text-gray-500">Tiers</p>
              </div>
            </div>
          </div>

          {/* Warnings */}
          {impact.warnings.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4">
              <h3 className="font-medium text-amber-400 mb-2">Warnings</h3>
              <ul className="space-y-1">
                {impact.warnings.map((warning, index) => (
                  <li key={index} className="text-sm text-amber-300 flex items-start gap-2">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* High Impact Confirmation */}
          {impact.isHighImpact && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="confirm-restore"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="w-5 h-5 rounded border-red-500 text-red-500 focus:ring-red-500"
                />
                <label htmlFor="confirm-restore" className="text-red-400 font-medium">
                  I understand this is a high-impact restore and want to proceed
                </label>
              </div>
              <p className="text-sm text-red-400/70 mt-2 ml-8">
                This restore affects {impact.usersAffected} users and makes {totalChanges} changes.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-900/20 border border-red-500 rounded-lg p-3" role="alert">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canRestore || isLoading}
            className="px-4 py-2 bg-amber-500 text-black font-medium rounded-lg hover:bg-amber-400 disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            Restore
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestoreModal;
