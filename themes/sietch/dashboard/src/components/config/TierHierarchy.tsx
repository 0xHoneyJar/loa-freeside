/**
 * Tier Hierarchy Visualizer
 *
 * Sprint 127: Tier Hierarchy Visualizer
 *
 * Interactive visualization of the tier hierarchy (Wanderer -> Fremen Council)
 * with tier details on click/hover. Uses a pyramid layout to show tier
 * relationships and access levels.
 *
 * @module components/config/TierHierarchy
 */

import React, { useState, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface TierThresholds {
  bgt?: number;
  engagement?: number;
  tenure?: number;
  activity?: number;
}

export interface TierData {
  /** Tier ID */
  id: string;
  /** Display name */
  name: string;
  /** Tier level (0 = lowest, higher = more exclusive) */
  level: number;
  /** Threshold requirements */
  thresholds: TierThresholds;
  /** Color for visualization */
  color: string;
  /** Number of users at this tier */
  userCount?: number;
  /** List of features accessible at this tier */
  features?: string[];
}

export interface TierHierarchyProps {
  /** Tier data array */
  tiers: TierData[];
  /** Currently selected tier ID */
  selectedTierId?: string;
  /** Callback when tier is selected */
  onTierSelect?: (tierId: string) => void;
  /** Optional loading state */
  isLoading?: boolean;
  /** Optional error message */
  error?: string;
}

interface TierNodeProps {
  tier: TierData;
  isSelected: boolean;
  onClick: () => void;
  width: number;
  totalTiers: number;
}

// =============================================================================
// Color Palette (Dune/THJ Theme)
// =============================================================================

const TIER_COLORS = {
  default: [
    'bg-amber-900', // Lowest tier
    'bg-amber-700',
    'bg-amber-600',
    'bg-amber-500',
    'bg-amber-400', // Highest tier
  ],
  border: [
    'border-amber-700',
    'border-amber-600',
    'border-amber-500',
    'border-amber-400',
    'border-amber-300',
  ],
  text: [
    'text-amber-200',
    'text-amber-100',
    'text-amber-50',
    'text-gray-900',
    'text-gray-900',
  ],
};

// =============================================================================
// Tier Node Component
// =============================================================================

const TierNode: React.FC<TierNodeProps> = ({
  tier,
  isSelected,
  onClick,
  width,
  totalTiers,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // Get color based on tier level
  const colorIndex = Math.min(tier.level, TIER_COLORS.default.length - 1);
  const bgColor = TIER_COLORS.default[colorIndex];
  const borderColor = TIER_COLORS.border[colorIndex];
  const textColor = TIER_COLORS.text[colorIndex];

  return (
    <div
      className={`
        relative cursor-pointer transition-all duration-200 ease-in-out
        rounded-lg p-4 m-2
        ${bgColor} ${borderColor} border-2
        ${isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900' : ''}
        ${isHovered ? 'scale-105 shadow-lg' : ''}
      `}
      style={{ width: `${width}%` }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick();
        }
      }}
      aria-selected={isSelected}
      aria-label={`Tier: ${tier.name}, ${tier.userCount ?? 0} users`}
    >
      <div className="flex flex-col items-center">
        <h3 className={`text-lg font-bold ${textColor}`}>{tier.name}</h3>

        {tier.userCount !== undefined && (
          <div className={`text-sm ${textColor} opacity-80 mt-1`}>
            {tier.userCount.toLocaleString()} users
          </div>
        )}

        {/* Quick threshold preview on hover */}
        {isHovered && (
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 z-10
                          bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl
                          min-w-[200px] text-left">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
              Requirements
            </div>
            {Object.entries(tier.thresholds).map(([key, value]) => (
              <div key={key} className="flex justify-between text-sm text-gray-300">
                <span className="capitalize">{key}:</span>
                <span className="font-mono">{value}</span>
              </div>
            ))}
            {Object.keys(tier.thresholds).length === 0 && (
              <div className="text-sm text-gray-500 italic">No thresholds set</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Tier Detail Panel
// =============================================================================

interface TierDetailPanelProps {
  tier: TierData | null;
  onClose: () => void;
}

const TierDetailPanel: React.FC<TierDetailPanelProps> = ({ tier, onClose }) => {
  if (!tier) return null;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mt-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">{tier.name}</h2>
          <p className="text-gray-400">Level {tier.level}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors"
          aria-label="Close panel"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Thresholds */}
        <div>
          <h3 className="text-lg font-semibold text-amber-400 mb-3">Thresholds</h3>
          <div className="space-y-2">
            {tier.thresholds.bgt !== undefined && (
              <ThresholdRow label="BGT Holdings" value={tier.thresholds.bgt} />
            )}
            {tier.thresholds.engagement !== undefined && (
              <ThresholdRow label="Engagement" value={tier.thresholds.engagement} />
            )}
            {tier.thresholds.tenure !== undefined && (
              <ThresholdRow label="Tenure (days)" value={tier.thresholds.tenure} />
            )}
            {tier.thresholds.activity !== undefined && (
              <ThresholdRow label="Activity Score" value={tier.thresholds.activity} />
            )}
            {Object.keys(tier.thresholds).length === 0 && (
              <p className="text-gray-500 italic">No thresholds configured</p>
            )}
          </div>
        </div>

        {/* Features */}
        <div>
          <h3 className="text-lg font-semibold text-amber-400 mb-3">Features</h3>
          {tier.features && tier.features.length > 0 ? (
            <ul className="space-y-1">
              {tier.features.map((feature) => (
                <li key={feature} className="flex items-center text-gray-300">
                  <svg className="w-4 h-4 mr-2 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 italic">No features assigned</p>
          )}
        </div>
      </div>

      {/* User Count */}
      {tier.userCount !== undefined && (
        <div className="mt-6 pt-4 border-t border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-gray-400">Users at this tier</span>
            <span className="text-2xl font-bold text-white">
              {tier.userCount.toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

const ThresholdRow: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex justify-between items-center py-1 px-3 bg-gray-900 rounded">
    <span className="text-gray-400">{label}</span>
    <span className="text-white font-mono">{value.toLocaleString()}</span>
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

export const TierHierarchy: React.FC<TierHierarchyProps> = ({
  tiers,
  selectedTierId,
  onTierSelect,
  isLoading = false,
  error,
}) => {
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);

  const effectiveSelectedId = selectedTierId ?? localSelectedId;
  const selectedTier = tiers.find((t) => t.id === effectiveSelectedId) ?? null;

  const handleTierSelect = useCallback(
    (tierId: string) => {
      if (onTierSelect) {
        onTierSelect(tierId);
      } else {
        setLocalSelectedId((prev) => (prev === tierId ? null : tierId));
      }
    },
    [onTierSelect]
  );

  const handleCloseDetail = useCallback(() => {
    if (onTierSelect) {
      onTierSelect('');
    } else {
      setLocalSelectedId(null);
    }
  }, [onTierSelect]);

  // Sort tiers by level (highest first for pyramid view)
  const sortedTiers = [...tiers].sort((a, b) => b.level - a.level);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
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

  if (tiers.length === 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 text-center">
        <p className="text-gray-400">No tiers configured</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Pyramid Visualization */}
      <div className="flex flex-col items-center py-8" role="list" aria-label="Tier hierarchy">
        {sortedTiers.map((tier, index) => {
          // Calculate width: highest tier is narrowest, lowest is widest
          const minWidth = 20;
          const maxWidth = 90;
          const widthStep = (maxWidth - minWidth) / Math.max(sortedTiers.length - 1, 1);
          const width = minWidth + widthStep * index;

          return (
            <TierNode
              key={tier.id}
              tier={tier}
              isSelected={tier.id === effectiveSelectedId}
              onClick={() => handleTierSelect(tier.id)}
              width={width}
              totalTiers={sortedTiers.length}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 text-sm text-gray-400 mb-4">
        <span>Click a tier to see details</span>
        <span>•</span>
        <span>Higher tiers = More exclusive</span>
      </div>

      {/* Detail Panel */}
      <TierDetailPanel tier={selectedTier} onClose={handleCloseDetail} />
    </div>
  );
};

// =============================================================================
// Default Export
// =============================================================================

export default TierHierarchy;
