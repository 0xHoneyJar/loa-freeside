/**
 * Threshold Editor Component
 *
 * Sprint 128: Threshold Editor
 *
 * Visual threshold editing with sliders, numeric input, validation,
 * and impact preview. Supports draft mode for batch changes.
 *
 * @module components/config/ThresholdEditor
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useDraftMode } from '../../hooks/useOptimisticUpdate';

// =============================================================================
// Types
// =============================================================================

export interface TierThresholds {
  bgt?: number;
  engagement?: number;
  tenure?: number;
  activity?: number;
}

export interface TierConfig {
  id: string;
  name: string;
  level: number;
  thresholds: TierThresholds;
}

export interface ThresholdValidationError {
  tierId: string;
  tierName: string;
  field: keyof TierThresholds;
  message: string;
}

export interface ImpactPreview {
  estimatedUsersAffected: number;
  usersGainingAccess: number;
  usersLosingAccess: number;
  affectedTiers: string[];
}

export interface ThresholdEditorProps {
  /** Tier configurations to edit */
  tiers: TierConfig[];
  /** Callback to save changes */
  onSave: (tiers: TierConfig[]) => Promise<TierConfig[]>;
  /** Optional impact preview calculator */
  calculateImpact?: (
    original: TierConfig[],
    draft: TierConfig[]
  ) => ImpactPreview;
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string;
  /** Whether editing is disabled */
  disabled?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const THRESHOLD_FIELDS: Array<{
  key: keyof TierThresholds;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  description: string;
}> = [
  {
    key: 'bgt',
    label: 'BGT Holdings',
    min: 0,
    max: 100000,
    step: 10,
    unit: 'BGT',
    description: 'Minimum BGT token holdings required',
  },
  {
    key: 'engagement',
    label: 'Engagement Score',
    min: 0,
    max: 1000,
    step: 1,
    unit: 'points',
    description: 'Minimum engagement score from activity',
  },
  {
    key: 'tenure',
    label: 'Tenure',
    min: 0,
    max: 365,
    step: 1,
    unit: 'days',
    description: 'Minimum days as a member',
  },
  {
    key: 'activity',
    label: 'Activity Score',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    description: 'Minimum activity percentage',
  },
];

// =============================================================================
// Validation
// =============================================================================

function validateTierOrdering(tiers: TierConfig[]): ThresholdValidationError[] {
  const errors: ThresholdValidationError[] = [];
  const sortedTiers = [...tiers].sort((a, b) => a.level - b.level);

  for (let i = 1; i < sortedTiers.length; i++) {
    const lowerTier = sortedTiers[i - 1];
    const higherTier = sortedTiers[i];

    for (const field of THRESHOLD_FIELDS) {
      const lowerValue = lowerTier.thresholds[field.key] ?? 0;
      const higherValue = higherTier.thresholds[field.key] ?? 0;

      if (higherValue < lowerValue) {
        errors.push({
          tierId: higherTier.id,
          tierName: higherTier.name,
          field: field.key,
          message: `${field.label} (${higherValue}) must be >= ${lowerTier.name} (${lowerValue})`,
        });
      }
    }
  }

  return errors;
}

// =============================================================================
// Slider Component
// =============================================================================

interface ThresholdSliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  label: string;
  unit: string;
  description: string;
  disabled?: boolean;
  hasError?: boolean;
  errorMessage?: string;
}

const ThresholdSlider: React.FC<ThresholdSliderProps> = ({
  value,
  onChange,
  min,
  max,
  step,
  label,
  unit,
  description,
  disabled = false,
  hasError = false,
  errorMessage,
}) => {
  const [inputMode, setInputMode] = useState<'slider' | 'number'>('slider');

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = Number(e.target.value);
    if (!isNaN(newValue)) {
      onChange(Math.min(max, Math.max(min, newValue)));
    }
  };

  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-gray-300">{label}</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setInputMode(inputMode === 'slider' ? 'number' : 'slider')}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            aria-label={`Switch to ${inputMode === 'slider' ? 'number' : 'slider'} input`}
            disabled={disabled}
          >
            {inputMode === 'slider' ? '123' : '|||'}
          </button>
          <span className={`text-sm font-mono ${hasError ? 'text-red-400' : 'text-amber-400'}`}>
            {value.toLocaleString()} {unit}
          </span>
        </div>
      </div>

      {inputMode === 'slider' ? (
        <div className="relative">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleSliderChange}
            disabled={disabled}
            className={`
              w-full h-2 rounded-lg appearance-none cursor-pointer
              bg-gray-700
              ${hasError ? 'accent-red-500' : 'accent-amber-500'}
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            aria-label={`${label} threshold slider`}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
          />
          {/* Progress fill */}
          <div
            className={`absolute top-0 left-0 h-2 rounded-l-lg pointer-events-none ${
              hasError ? 'bg-red-500' : 'bg-amber-500'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      ) : (
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleNumberChange}
          disabled={disabled}
          className={`
            w-full px-3 py-2 rounded-lg
            bg-gray-800 border
            ${hasError ? 'border-red-500' : 'border-gray-600'}
            text-white font-mono
            focus:outline-none focus:ring-2
            ${hasError ? 'focus:ring-red-500' : 'focus:ring-amber-500'}
            disabled:opacity-50
          `}
          aria-label={`${label} threshold input`}
        />
      )}

      <p className="text-xs text-gray-500">{description}</p>

      {hasError && errorMessage && (
        <p className="text-xs text-red-400" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
};

// =============================================================================
// Impact Preview Component
// =============================================================================

interface ImpactPreviewPanelProps {
  impact: ImpactPreview | null;
  isCalculating?: boolean;
}

const ImpactPreviewPanel: React.FC<ImpactPreviewPanelProps> = ({
  impact,
  isCalculating = false,
}) => {
  if (isCalculating) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <div className="animate-pulse flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-gray-600" />
          <span className="text-gray-400">Calculating impact...</span>
        </div>
      </div>
    );
  }

  if (!impact) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <p className="text-gray-400 text-sm">Make changes to see impact preview</p>
      </div>
    );
  }

  const isHighImpact = impact.estimatedUsersAffected > 10;

  return (
    <div
      className={`rounded-lg p-4 border ${
        isHighImpact
          ? 'bg-red-900/20 border-red-500'
          : 'bg-gray-800 border-gray-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        {isHighImpact && (
          <span className="text-red-400 font-bold">HIGH IMPACT</span>
        )}
        <h4 className="text-sm font-semibold text-gray-300">Impact Preview</h4>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-white">
            {impact.estimatedUsersAffected.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400">Users Affected</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-400">
            +{impact.usersGainingAccess.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400">Gaining Access</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-400">
            -{impact.usersLosingAccess.toLocaleString()}
          </div>
          <div className="text-xs text-gray-400">Losing Access</div>
        </div>
      </div>

      {impact.affectedTiers.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Affected Tiers:</div>
          <div className="flex flex-wrap gap-1">
            {impact.affectedTiers.map((tier) => (
              <span
                key={tier}
                className="px-2 py-0.5 bg-amber-900/50 text-amber-200 rounded text-xs"
              >
                {tier}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Tier Editor Card
// =============================================================================

interface TierEditorCardProps {
  tier: TierConfig;
  onUpdate: (thresholds: TierThresholds) => void;
  errors: ThresholdValidationError[];
  disabled?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

const TierEditorCard: React.FC<TierEditorCardProps> = ({
  tier,
  onUpdate,
  errors,
  disabled = false,
  isExpanded,
  onToggle,
}) => {
  const handleFieldChange = (field: keyof TierThresholds, value: number) => {
    onUpdate({
      ...tier.thresholds,
      [field]: value,
    });
  };

  const tierErrors = errors.filter((e) => e.tierId === tier.id);
  const hasErrors = tierErrors.length > 0;

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        hasErrors ? 'border-red-500' : 'border-gray-700'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`
          w-full px-4 py-3 flex items-center justify-between
          ${hasErrors ? 'bg-red-900/20' : 'bg-gray-800'}
          hover:bg-gray-750 transition-colors
        `}
        aria-expanded={isExpanded}
        aria-controls={`tier-${tier.id}-content`}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-white">{tier.name}</span>
          <span className="px-2 py-0.5 bg-gray-700 text-gray-400 rounded text-xs">
            Level {tier.level}
          </span>
          {hasErrors && (
            <span className="px-2 py-0.5 bg-red-900 text-red-300 rounded text-xs">
              {tierErrors.length} error{tierErrors.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isExpanded && (
        <div id={`tier-${tier.id}-content`} className="p-4 bg-gray-900 space-y-4">
          {THRESHOLD_FIELDS.map((field) => {
            const fieldError = tierErrors.find((e) => e.field === field.key);
            return (
              <ThresholdSlider
                key={field.key}
                value={tier.thresholds[field.key] ?? 0}
                onChange={(value) => handleFieldChange(field.key, value)}
                min={field.min}
                max={field.max}
                step={field.step}
                label={field.label}
                unit={field.unit}
                description={field.description}
                disabled={disabled}
                hasError={!!fieldError}
                errorMessage={fieldError?.message}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const ThresholdEditor: React.FC<ThresholdEditorProps> = ({
  tiers,
  onSave,
  calculateImpact,
  isLoading = false,
  error,
  disabled = false,
}) => {
  // Sort tiers by level (highest first for pyramid view)
  const sortedTiers = useMemo(
    () => [...tiers].sort((a, b) => b.level - a.level),
    [tiers]
  );

  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(
    () => new Set(sortedTiers.slice(0, 1).map((t) => t.id))
  );

  const { state, updateDraft, publish, discard } = useDraftMode({
    value: tiers,
    onPublish: onSave,
  });

  const validationErrors = useMemo(
    () => validateTierOrdering(state.draft),
    [state.draft]
  );

  const impact = useMemo(() => {
    if (!calculateImpact || !state.isDirty) return null;
    return calculateImpact(state.original, state.draft);
  }, [calculateImpact, state.isDirty, state.original, state.draft]);

  const handleTierUpdate = useCallback(
    (tierId: string, thresholds: TierThresholds) => {
      const updated = state.draft.map((t) =>
        t.id === tierId ? { ...t, thresholds } : t
      );
      updateDraft(updated);
    },
    [state.draft, updateDraft]
  );

  const toggleTier = useCallback((tierId: string) => {
    setExpandedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tierId)) {
        next.delete(tierId);
      } else {
        next.add(tierId);
      }
      return next;
    });
  }, []);

  const handlePublish = async () => {
    if (validationErrors.length > 0) {
      return;
    }
    await publish();
  };

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

  const displayTiers = [...state.draft].sort((a, b) => b.level - a.level);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Threshold Editor</h2>
          <p className="text-sm text-gray-400">
            Configure tier threshold requirements
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state.isDirty && (
            <>
              <span className="text-sm text-amber-400">Unsaved changes</span>
              <button
                onClick={discard}
                disabled={disabled || state.isPublishing}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
              >
                Discard
              </button>
            </>
          )}
          <button
            onClick={handlePublish}
            disabled={
              disabled ||
              !state.isDirty ||
              state.isPublishing ||
              validationErrors.length > 0
            }
            className={`
              px-4 py-2 rounded-lg font-medium transition-colors
              ${
                state.isDirty && validationErrors.length === 0
                  ? 'bg-amber-500 text-gray-900 hover:bg-amber-400'
                  : 'bg-gray-700 text-gray-400 cursor-not-allowed'
              }
              disabled:opacity-50
            `}
          >
            {state.isPublishing ? 'Publishing...' : 'Publish Changes'}
          </button>
        </div>
      </div>

      {/* Validation Errors Summary */}
      {validationErrors.length > 0 && (
        <div
          className="bg-red-900/20 border border-red-500 rounded-lg p-4"
          role="alert"
        >
          <h3 className="font-semibold text-red-400 mb-2">Validation Errors</h3>
          <ul className="space-y-1 text-sm text-red-300">
            {validationErrors.map((err, i) => (
              <li key={i}>
                <strong>{err.tierName}:</strong> {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Impact Preview */}
      <ImpactPreviewPanel impact={impact} />

      {/* Error from publish */}
      {state.error && (
        <div
          className="bg-red-900/20 border border-red-500 rounded-lg p-4"
          role="alert"
        >
          <p className="text-red-400">{state.error.message}</p>
        </div>
      )}

      {/* Tier Cards */}
      <div className="space-y-3">
        {displayTiers.map((tier) => (
          <TierEditorCard
            key={tier.id}
            tier={tier}
            onUpdate={(thresholds) => handleTierUpdate(tier.id, thresholds)}
            errors={validationErrors}
            disabled={disabled || state.isPublishing}
            isExpanded={expandedTiers.has(tier.id)}
            onToggle={() => toggleTier(tier.id)}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>Note: Higher tier thresholds must be greater than or equal to lower tier thresholds.</p>
        <p>Changes are saved in draft mode until you click &quot;Publish Changes&quot;.</p>
      </div>
    </div>
  );
};

// =============================================================================
// Default Export
// =============================================================================

export default ThresholdEditor;
