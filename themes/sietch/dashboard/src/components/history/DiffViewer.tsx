/**
 * Diff Viewer Component
 *
 * Sprint 130: Role Mapping & History
 *
 * Side-by-side comparison of configuration versions.
 *
 * @module components/history/DiffViewer
 */

import React, { useMemo } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface ConfigSnapshot {
  id: string;
  timestamp: Date;
  label?: string;
  data: Record<string, unknown>;
}

export interface DiffViewerProps {
  /** Left side (older version) */
  left: ConfigSnapshot;
  /** Right side (newer version) */
  right: ConfigSnapshot;
  /** Optional title */
  title?: string;
  /** Show unchanged lines */
  showUnchanged?: boolean;
  /** Callback when restore is requested */
  onRestore?: (snapshot: ConfigSnapshot) => void;
}

// =============================================================================
// Diff Calculation
// =============================================================================

function deepCompare(obj1: unknown, obj2: unknown): boolean {
  if (obj1 === obj2) return true;
  if (typeof obj1 !== typeof obj2) return false;
  if (obj1 === null || obj2 === null) return obj1 === obj2;
  if (typeof obj1 !== 'object') return obj1 === obj2;

  const keys1 = Object.keys(obj1 as Record<string, unknown>);
  const keys2 = Object.keys(obj2 as Record<string, unknown>);

  if (keys1.length !== keys2.length) return false;

  return keys1.every((key) =>
    deepCompare(
      (obj1 as Record<string, unknown>)[key],
      (obj2 as Record<string, unknown>)[key]
    )
  );
}

function calculateDiff(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  path = ''
): DiffLine[] {
  const lines: DiffLine[] = [];
  const allKeys = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const key of allKeys) {
    const fullPath = path ? `${path}.${key}` : key;
    const leftHas = key in left;
    const rightHas = key in right;
    const leftVal = left[key];
    const rightVal = right[key];

    if (!leftHas && rightHas) {
      // Added
      if (typeof rightVal === 'object' && rightVal !== null && !Array.isArray(rightVal)) {
        lines.push(...calculateDiff({}, rightVal as Record<string, unknown>, fullPath));
      } else {
        lines.push({ type: 'added', path: fullPath, newValue: rightVal });
      }
    } else if (leftHas && !rightHas) {
      // Removed
      if (typeof leftVal === 'object' && leftVal !== null && !Array.isArray(leftVal)) {
        lines.push(...calculateDiff(leftVal as Record<string, unknown>, {}, fullPath));
      } else {
        lines.push({ type: 'removed', path: fullPath, oldValue: leftVal });
      }
    } else if (leftHas && rightHas) {
      const leftIsObj = typeof leftVal === 'object' && leftVal !== null && !Array.isArray(leftVal);
      const rightIsObj = typeof rightVal === 'object' && rightVal !== null && !Array.isArray(rightVal);

      if (leftIsObj && rightIsObj) {
        // Recurse into objects
        lines.push(...calculateDiff(
          leftVal as Record<string, unknown>,
          rightVal as Record<string, unknown>,
          fullPath
        ));
      } else if (deepCompare(leftVal, rightVal)) {
        // Unchanged
        lines.push({ type: 'unchanged', path: fullPath, oldValue: leftVal, newValue: rightVal });
      } else {
        // Modified
        lines.push({ type: 'modified', path: fullPath, oldValue: leftVal, newValue: rightVal });
      }
    }
  }

  return lines;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

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
// Helper Components
// =============================================================================

interface DiffLineRowProps {
  line: DiffLine;
}

const DiffLineRow: React.FC<DiffLineRowProps> = ({ line }) => {
  const baseClasses = 'grid grid-cols-2 border-b border-gray-800';

  switch (line.type) {
    case 'added':
      return (
        <div className={baseClasses}>
          <div className="px-4 py-2 bg-gray-900/50 text-gray-500">
            <span className="text-gray-600">{line.path}</span>
          </div>
          <div className="px-4 py-2 bg-green-900/20">
            <span className="text-green-400 mr-2">+</span>
            <span className="text-gray-400">{line.path}: </span>
            <span className="text-green-300">{formatValue(line.newValue)}</span>
          </div>
        </div>
      );

    case 'removed':
      return (
        <div className={baseClasses}>
          <div className="px-4 py-2 bg-red-900/20">
            <span className="text-red-400 mr-2">-</span>
            <span className="text-gray-400">{line.path}: </span>
            <span className="text-red-300">{formatValue(line.oldValue)}</span>
          </div>
          <div className="px-4 py-2 bg-gray-900/50 text-gray-500">
            <span className="text-gray-600">{line.path}</span>
          </div>
        </div>
      );

    case 'modified':
      return (
        <div className={baseClasses}>
          <div className="px-4 py-2 bg-amber-900/10">
            <span className="text-amber-400 mr-2">~</span>
            <span className="text-gray-400">{line.path}: </span>
            <span className="text-amber-300/70">{formatValue(line.oldValue)}</span>
          </div>
          <div className="px-4 py-2 bg-amber-900/20">
            <span className="text-amber-400 mr-2">~</span>
            <span className="text-gray-400">{line.path}: </span>
            <span className="text-amber-300">{formatValue(line.newValue)}</span>
          </div>
        </div>
      );

    case 'unchanged':
    default:
      return (
        <div className={baseClasses}>
          <div className="px-4 py-2 text-gray-500">
            <span className="mr-2">&nbsp;</span>
            <span className="text-gray-600">{line.path}: </span>
            <span className="text-gray-600">{formatValue(line.oldValue)}</span>
          </div>
          <div className="px-4 py-2 text-gray-500">
            <span className="mr-2">&nbsp;</span>
            <span className="text-gray-600">{line.path}: </span>
            <span className="text-gray-600">{formatValue(line.newValue)}</span>
          </div>
        </div>
      );
  }
};

// =============================================================================
// Main Component
// =============================================================================

export const DiffViewer: React.FC<DiffViewerProps> = ({
  left,
  right,
  title,
  showUnchanged = false,
  onRestore,
}) => {
  const diffLines = useMemo(
    () => calculateDiff(left.data, right.data),
    [left.data, right.data]
  );

  const filteredLines = useMemo(
    () => (showUnchanged ? diffLines : diffLines.filter((l) => l.type !== 'unchanged')),
    [diffLines, showUnchanged]
  );

  const stats = useMemo(() => {
    return {
      added: diffLines.filter((l) => l.type === 'added').length,
      removed: diffLines.filter((l) => l.type === 'removed').length,
      modified: diffLines.filter((l) => l.type === 'modified').length,
      unchanged: diffLines.filter((l) => l.type === 'unchanged').length,
    };
  }, [diffLines]);

  const hasChanges = stats.added > 0 || stats.removed > 0 || stats.modified > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {title && <h2 className="text-xl font-bold text-white mb-1">{title}</h2>}
          <div className="flex items-center gap-4 text-sm">
            <span className="text-green-400">+{stats.added} added</span>
            <span className="text-red-400">-{stats.removed} removed</span>
            <span className="text-amber-400">~{stats.modified} modified</span>
            {showUnchanged && (
              <span className="text-gray-500">{stats.unchanged} unchanged</span>
            )}
          </div>
        </div>
        {onRestore && (
          <button
            onClick={() => onRestore(left)}
            disabled={!hasChanges}
            className="px-4 py-2 bg-amber-500 text-black font-medium rounded-lg hover:bg-amber-400 disabled:opacity-50"
          >
            Restore to Left
          </button>
        )}
      </div>

      {/* Version Headers */}
      <div className="grid grid-cols-2 bg-gray-800 rounded-t-lg overflow-hidden">
        <div className="px-4 py-3 border-r border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-white">
                {left.label || 'Previous Version'}
              </p>
              <p className="text-xs text-gray-500">
                {formatTimestamp(left.timestamp)}
              </p>
            </div>
            <span className="px-2 py-0.5 text-xs bg-gray-700 text-gray-400 rounded">
              Before
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-white">
                {right.label || 'Current Version'}
              </p>
              <p className="text-xs text-gray-500">
                {formatTimestamp(right.timestamp)}
              </p>
            </div>
            <span className="px-2 py-0.5 text-xs bg-amber-500 text-black rounded">
              After
            </span>
          </div>
        </div>
      </div>

      {/* Diff Content */}
      {!hasChanges ? (
        <div className="bg-gray-900 rounded-b-lg p-8 text-center">
          <p className="text-gray-400">No differences found</p>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-b-lg overflow-hidden font-mono text-sm">
          {filteredLines.map((line, index) => (
            <DiffLineRow key={`${line.path}-${index}`} line={line} />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>
          <span className="inline-block w-4 text-center text-green-400 mr-1">+</span>
          Added
        </span>
        <span>
          <span className="inline-block w-4 text-center text-red-400 mr-1">-</span>
          Removed
        </span>
        <span>
          <span className="inline-block w-4 text-center text-amber-400 mr-1">~</span>
          Modified
        </span>
      </div>
    </div>
  );
};

export default DiffViewer;
