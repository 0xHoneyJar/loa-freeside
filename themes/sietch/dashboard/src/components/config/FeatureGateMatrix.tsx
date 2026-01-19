/**
 * Feature Gate Matrix Component
 *
 * Sprint 129: Feature Gate Matrix
 *
 * Toggle grid for feature/tier permissions. Features as rows, tiers as columns.
 * Supports conditional access display, filtering, and batch updates.
 *
 * @module components/config/FeatureGateMatrix
 */

import React, { useState, useCallback, useMemo } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface FeatureConfig {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Tiers that have access to this feature */
  enabledTiers: string[];
  /** Optional OR conditions (e.g., "Has NFT" OR "Has Role") */
  orConditions?: OrCondition[];
}

export interface OrCondition {
  id: string;
  type: 'badge' | 'nft' | 'role' | 'custom';
  label: string;
  description?: string;
}

export interface TierInfo {
  id: string;
  name: string;
  level: number;
  color?: string;
}

export interface FeatureGateMatrixProps {
  /** Features to display */
  features: FeatureConfig[];
  /** Available tiers */
  tiers: TierInfo[];
  /** Callback when feature gates change */
  onUpdate: (features: FeatureConfig[]) => void;
  /** Filter features by category */
  categoryFilter?: string;
  /** All available categories */
  categories?: string[];
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string;
  /** Disable all interactions */
  disabled?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const TIER_COLORS: Record<number, string> = {
  0: 'bg-gray-600',
  1: 'bg-amber-700',
  2: 'bg-amber-600',
  3: 'bg-amber-500',
  4: 'bg-amber-400',
  5: 'bg-amber-300',
};

// =============================================================================
// Helper Components
// =============================================================================

interface FeatureTooltipProps {
  feature: FeatureConfig;
}

const FeatureTooltip: React.FC<FeatureTooltipProps> = ({ feature }) => {
  return (
    <div
      className="absolute z-50 w-64 p-3 bg-gray-800 border border-gray-700 rounded-lg shadow-xl -top-2 left-full ml-2"
      role="tooltip"
    >
      <h4 className="font-semibold text-white mb-1">{feature.name}</h4>
      <p className="text-sm text-gray-400 mb-2">{feature.description}</p>
      <p className="text-xs text-gray-500">Category: {feature.category}</p>
      {feature.orConditions && feature.orConditions.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-700">
          <p className="text-xs text-amber-400 mb-1">OR Conditions:</p>
          <ul className="text-xs text-gray-400 space-y-1">
            {feature.orConditions.map((cond) => (
              <li key={cond.id}>• {cond.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

interface OrBadgeProps {
  conditions: OrCondition[];
}

const OrBadge: React.FC<OrBadgeProps> = ({ conditions }) => {
  if (!conditions || conditions.length === 0) return null;

  return (
    <span
      className="ml-2 px-1.5 py-0.5 text-xs bg-purple-900/50 text-purple-300 rounded"
      title={conditions.map((c) => c.label).join(' OR ')}
    >
      OR +{conditions.length}
    </span>
  );
};

interface CheckboxCellProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  featureName: string;
  tierName: string;
}

const CheckboxCell: React.FC<CheckboxCellProps> = ({
  checked,
  onChange,
  disabled = false,
  featureName,
  tierName,
}) => {
  return (
    <td className="px-4 py-3 text-center border-b border-gray-800">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`
          w-6 h-6 rounded border-2 flex items-center justify-center
          transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50
          ${
            checked
              ? 'bg-amber-500 border-amber-500 text-black'
              : 'bg-transparent border-gray-600 hover:border-gray-500'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        aria-label={`${featureName} enabled for ${tierName}: ${checked ? 'yes' : 'no'}`}
        aria-pressed={checked}
      >
        {checked && (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
    </td>
  );
};

interface FeatureRowProps {
  feature: FeatureConfig;
  tiers: TierInfo[];
  onToggle: (featureId: string, tierId: string, enabled: boolean) => void;
  disabled?: boolean;
  isSelected: boolean;
  onSelect: (selected: boolean) => void;
  showBatchSelect: boolean;
}

const FeatureRow: React.FC<FeatureRowProps> = ({
  feature,
  tiers,
  onToggle,
  disabled = false,
  isSelected,
  onSelect,
  showBatchSelect,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <tr className="hover:bg-gray-800/50">
      {showBatchSelect && (
        <td className="px-4 py-3 border-b border-gray-800">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 text-amber-500 focus:ring-amber-500"
            aria-label={`Select ${feature.name} for batch update`}
          />
        </td>
      )}
      <td className="px-4 py-3 border-b border-gray-800 relative">
        <div
          className="flex items-center"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <span className="text-white font-medium cursor-help">{feature.name}</span>
          {feature.orConditions && feature.orConditions.length > 0 && (
            <OrBadge conditions={feature.orConditions} />
          )}
          {showTooltip && <FeatureTooltip feature={feature} />}
        </div>
      </td>
      {tiers.map((tier) => (
        <CheckboxCell
          key={tier.id}
          checked={feature.enabledTiers.includes(tier.id)}
          onChange={(enabled) => onToggle(feature.id, tier.id, enabled)}
          disabled={disabled}
          featureName={feature.name}
          tierName={tier.name}
        />
      ))}
    </tr>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const FeatureGateMatrix: React.FC<FeatureGateMatrixProps> = ({
  features,
  tiers,
  onUpdate,
  categoryFilter,
  categories = [],
  isLoading = false,
  error,
  disabled = false,
}) => {
  const [selectedCategory, setSelectedCategory] = useState(categoryFilter || '');
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
  const [showBatchMode, setShowBatchMode] = useState(false);

  // Sort tiers by level (lowest first for left-to-right progression)
  const sortedTiers = useMemo(
    () => [...tiers].sort((a, b) => a.level - b.level),
    [tiers]
  );

  // Filter features by category
  const filteredFeatures = useMemo(() => {
    if (!selectedCategory) return features;
    return features.filter((f) => f.category === selectedCategory);
  }, [features, selectedCategory]);

  // Group features by category for display
  const groupedFeatures = useMemo(() => {
    const groups = new Map<string, FeatureConfig[]>();
    for (const feature of filteredFeatures) {
      const existing = groups.get(feature.category) || [];
      existing.push(feature);
      groups.set(feature.category, existing);
    }
    return groups;
  }, [filteredFeatures]);

  // Derive unique categories from features
  const availableCategories = useMemo(() => {
    if (categories.length > 0) return categories;
    return [...new Set(features.map((f) => f.category))].sort();
  }, [features, categories]);

  const handleToggle = useCallback(
    (featureId: string, tierId: string, enabled: boolean) => {
      const updated = features.map((f) => {
        if (f.id !== featureId) return f;
        const newEnabledTiers = enabled
          ? [...f.enabledTiers, tierId]
          : f.enabledTiers.filter((id) => id !== tierId);
        return { ...f, enabledTiers: newEnabledTiers };
      });
      onUpdate(updated);
    },
    [features, onUpdate]
  );

  const handleSelectFeature = useCallback((featureId: string, selected: boolean) => {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(featureId);
      } else {
        next.delete(featureId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) {
        setSelectedFeatures(new Set(filteredFeatures.map((f) => f.id)));
      } else {
        setSelectedFeatures(new Set());
      }
    },
    [filteredFeatures]
  );

  const handleBatchEnable = useCallback(
    (tierId: string) => {
      const updated = features.map((f) => {
        if (!selectedFeatures.has(f.id)) return f;
        if (f.enabledTiers.includes(tierId)) return f;
        return { ...f, enabledTiers: [...f.enabledTiers, tierId] };
      });
      onUpdate(updated);
    },
    [features, selectedFeatures, onUpdate]
  );

  const handleBatchDisable = useCallback(
    (tierId: string) => {
      const updated = features.map((f) => {
        if (!selectedFeatures.has(f.id)) return f;
        return { ...f, enabledTiers: f.enabledTiers.filter((id) => id !== tierId) };
      });
      onUpdate(updated);
    },
    [features, selectedFeatures, onUpdate]
  );

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

  if (features.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No features configured</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Feature Gates</h2>
          <p className="text-sm text-gray-400">
            Configure feature access by tier
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Category Filter */}
          {availableCategories.length > 0 && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
              aria-label="Filter by category"
            >
              <option value="">All Categories</option>
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          )}

          {/* Batch Mode Toggle */}
          <button
            onClick={() => {
              setShowBatchMode(!showBatchMode);
              if (showBatchMode) {
                setSelectedFeatures(new Set());
              }
            }}
            className={`
              px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${
                showBatchMode
                  ? 'bg-amber-500 text-black'
                  : 'bg-gray-700 text-white hover:bg-gray-600'
              }
            `}
          >
            {showBatchMode ? 'Exit Batch Mode' : 'Batch Update'}
          </button>
        </div>
      </div>

      {/* Batch Actions Bar */}
      {showBatchMode && selectedFeatures.size > 0 && (
        <div className="flex items-center gap-4 p-3 bg-amber-900/20 border border-amber-500/30 rounded-lg">
          <span className="text-amber-400 text-sm">
            {selectedFeatures.size} feature{selectedFeatures.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">Enable for:</span>
            {sortedTiers.map((tier) => (
              <button
                key={tier.id}
                onClick={() => handleBatchEnable(tier.id)}
                disabled={disabled}
                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded disabled:opacity-50"
              >
                {tier.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm">Disable for:</span>
            {sortedTiers.map((tier) => (
              <button
                key={tier.id}
                onClick={() => handleBatchDisable(tier.id)}
                disabled={disabled}
                className="px-2 py-1 bg-gray-700 hover:bg-red-900 text-white text-xs rounded disabled:opacity-50"
              >
                {tier.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Feature Matrix Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-800">
              {showBatchMode && (
                <th className="px-4 py-3 text-left border-b border-gray-700">
                  <input
                    type="checkbox"
                    checked={
                      selectedFeatures.size === filteredFeatures.length &&
                      filteredFeatures.length > 0
                    }
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 text-amber-500 focus:ring-amber-500"
                    aria-label="Select all features"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-gray-400 font-medium border-b border-gray-700">
                Feature
              </th>
              {sortedTiers.map((tier) => (
                <th
                  key={tier.id}
                  className="px-4 py-3 text-center border-b border-gray-700"
                >
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${
                        TIER_COLORS[tier.level] || 'bg-gray-600'
                      } text-black`}
                    >
                      {tier.name}
                    </span>
                    <span className="text-xs text-gray-500">Level {tier.level}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selectedCategory === '' ? (
              // Show grouped by category
              Array.from(groupedFeatures.entries()).map(([category, categoryFeatures]) => (
                <React.Fragment key={category}>
                  <tr className="bg-gray-900/50">
                    <td
                      colSpan={sortedTiers.length + (showBatchMode ? 2 : 1)}
                      className="px-4 py-2 text-sm font-medium text-amber-400 border-b border-gray-800"
                    >
                      {category}
                    </td>
                  </tr>
                  {categoryFeatures.map((feature) => (
                    <FeatureRow
                      key={feature.id}
                      feature={feature}
                      tiers={sortedTiers}
                      onToggle={handleToggle}
                      disabled={disabled}
                      isSelected={selectedFeatures.has(feature.id)}
                      onSelect={(selected) => handleSelectFeature(feature.id, selected)}
                      showBatchSelect={showBatchMode}
                    />
                  ))}
                </React.Fragment>
              ))
            ) : (
              // Show flat list when filtered
              filteredFeatures.map((feature) => (
                <FeatureRow
                  key={feature.id}
                  feature={feature}
                  tiers={sortedTiers}
                  onToggle={handleToggle}
                  disabled={disabled}
                  isSelected={selectedFeatures.has(feature.id)}
                  onSelect={(selected) => handleSelectFeature(feature.id, selected)}
                  showBatchSelect={showBatchMode}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>
          <span className="inline-block w-4 h-4 bg-amber-500 rounded mr-2 align-middle" />
          Feature enabled for tier
        </p>
        <p>
          <span className="inline-block px-1.5 py-0.5 bg-purple-900/50 text-purple-300 rounded mr-2 align-middle text-xs">
            OR
          </span>
          Feature has alternative access conditions
        </p>
      </div>
    </div>
  );
};

export default FeatureGateMatrix;
