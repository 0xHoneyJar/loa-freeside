/**
 * State Editor Component
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Form for editing simulated user state (BGT, engagement, tenure, badges).
 * Includes scenario templates for common test cases.
 *
 * @module components/sandbox/StateEditor
 */

import React, { useState, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface UserState {
  /** BGT token balance */
  bgt: number;
  /** Engagement score (0-100) */
  engagement: number;
  /** Tenure in days */
  tenureDays: number;
  /** Badges the user has */
  badges: string[];
  /** NFTs the user holds */
  nfts: string[];
  /** Custom attributes */
  customAttributes: Record<string, string | number | boolean>;
}

export interface ScenarioTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  state: UserState;
}

export interface StateEditorProps {
  /** Current user state */
  state: UserState;
  /** Callback when state changes */
  onChange: (state: UserState) => void;
  /** Available badges for selection */
  availableBadges?: string[];
  /** Available NFTs for selection */
  availableNfts?: string[];
  /** Scenario templates */
  templates?: ScenarioTemplate[];
  /** Loading state */
  isLoading?: boolean;
  /** Disabled state */
  disabled?: boolean;
}

// =============================================================================
// Default Templates
// =============================================================================

const DEFAULT_TEMPLATES: ScenarioTemplate[] = [
  {
    id: 'new-user',
    name: 'New User',
    description: 'Fresh account with no history',
    icon: '🌱',
    state: {
      bgt: 0,
      engagement: 0,
      tenureDays: 0,
      badges: [],
      nfts: [],
      customAttributes: {},
    },
  },
  {
    id: 'whale',
    name: 'Whale',
    description: 'High BGT holder',
    icon: '🐋',
    state: {
      bgt: 50000,
      engagement: 75,
      tenureDays: 180,
      badges: ['early-adopter', 'contributor'],
      nfts: ['genesis-nft'],
      customAttributes: {},
    },
  },
  {
    id: 'veteran',
    name: 'Veteran',
    description: 'Long-time community member',
    icon: '🎖️',
    state: {
      bgt: 5000,
      engagement: 95,
      tenureDays: 365,
      badges: ['og', 'helper', 'event-participant'],
      nfts: [],
      customAttributes: {},
    },
  },
  {
    id: 'lurker',
    name: 'Lurker',
    description: 'Inactive but tenured user',
    icon: '👀',
    state: {
      bgt: 100,
      engagement: 5,
      tenureDays: 200,
      badges: [],
      nfts: [],
      customAttributes: {},
    },
  },
];

// =============================================================================
// Helper Components
// =============================================================================

interface NumberInputProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  suffix?: string;
}

const NumberInput: React.FC<NumberInputProps> = ({
  id,
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled,
  suffix,
}) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-gray-400 mb-1">
      {label}
    </label>
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
      />
      {suffix && <span className="text-gray-500 text-sm">{suffix}</span>}
    </div>
  </div>
);

interface MultiSelectProps {
  id: string;
  label: string;
  selected: string[];
  options: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  id,
  label,
  selected,
  options,
  onChange,
  disabled,
}) => {
  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-400 mb-2">{label}</label>
      <div
        id={id}
        role="group"
        aria-label={label}
        className="flex flex-wrap gap-2"
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => toggleOption(option)}
            disabled={disabled}
            className={`px-3 py-1 rounded-full text-sm transition-colors ${
              selected.includes(option)
                ? 'bg-amber-500 text-black'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            } disabled:opacity-50`}
          >
            {option}
          </button>
        ))}
        {options.length === 0 && (
          <p className="text-gray-500 text-sm">No options available</p>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const StateEditor: React.FC<StateEditorProps> = ({
  state,
  onChange,
  availableBadges = ['early-adopter', 'contributor', 'og', 'helper', 'event-participant'],
  availableNfts = ['genesis-nft', 'limited-edition', 'community-award'],
  templates = DEFAULT_TEMPLATES,
  isLoading = false,
  disabled = false,
}) => {
  const [showCustomAttributes, setShowCustomAttributes] = useState(false);
  const [newAttrKey, setNewAttrKey] = useState('');
  const [newAttrValue, setNewAttrValue] = useState('');

  const updateField = useCallback(
    <K extends keyof UserState>(field: K, value: UserState[K]) => {
      onChange({ ...state, [field]: value });
    },
    [state, onChange]
  );

  const applyTemplate = useCallback(
    (template: ScenarioTemplate) => {
      onChange(template.state);
    },
    [onChange]
  );

  const addCustomAttribute = useCallback(() => {
    if (!newAttrKey.trim()) return;
    onChange({
      ...state,
      customAttributes: {
        ...state.customAttributes,
        [newAttrKey.trim()]: newAttrValue,
      },
    });
    setNewAttrKey('');
    setNewAttrValue('');
  }, [state, onChange, newAttrKey, newAttrValue]);

  const removeCustomAttribute = useCallback(
    (key: string) => {
      const { [key]: _, ...rest } = state.customAttributes;
      onChange({ ...state, customAttributes: rest });
    },
    [state, onChange]
  );

  const isDisabled = disabled || isLoading;

  return (
    <div className="space-y-6">
      {/* Loading Overlay */}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <svg
            className="animate-spin h-6 w-6 text-amber-500"
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
      )}

      {/* Scenario Templates */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3">Quick Scenarios</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => applyTemplate(template)}
              disabled={isDisabled}
              className="flex flex-col items-center p-3 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={template.description}
            >
              <span className="text-2xl mb-1">{template.icon}</span>
              <span className="text-sm font-medium text-white">{template.name}</span>
              <span className="text-xs text-gray-500">{template.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Core Stats */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-white mb-4">Core Stats</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumberInput
            id="bgt-input"
            label="BGT Balance"
            value={state.bgt}
            onChange={(v) => updateField('bgt', v)}
            min={0}
            disabled={isDisabled}
            suffix="BGT"
          />
          <NumberInput
            id="engagement-input"
            label="Engagement Score"
            value={state.engagement}
            onChange={(v) => updateField('engagement', v)}
            min={0}
            max={100}
            disabled={isDisabled}
            suffix="%"
          />
          <NumberInput
            id="tenure-input"
            label="Tenure"
            value={state.tenureDays}
            onChange={(v) => updateField('tenureDays', v)}
            min={0}
            disabled={isDisabled}
            suffix="days"
          />
        </div>
      </div>

      {/* Badges */}
      <div className="bg-gray-800 rounded-lg p-4">
        <MultiSelect
          id="badges-select"
          label="Badges"
          selected={state.badges}
          options={availableBadges}
          onChange={(badges) => updateField('badges', badges)}
          disabled={isDisabled}
        />
      </div>

      {/* NFTs */}
      <div className="bg-gray-800 rounded-lg p-4">
        <MultiSelect
          id="nfts-select"
          label="NFTs"
          selected={state.nfts}
          options={availableNfts}
          onChange={(nfts) => updateField('nfts', nfts)}
          disabled={isDisabled}
        />
      </div>

      {/* Custom Attributes */}
      <div className="bg-gray-800 rounded-lg p-4">
        <button
          type="button"
          onClick={() => setShowCustomAttributes(!showCustomAttributes)}
          className="flex items-center justify-between w-full text-left"
        >
          <h3 className="text-sm font-medium text-white">Custom Attributes</h3>
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${
              showCustomAttributes ? 'rotate-180' : ''
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

        {showCustomAttributes && (
          <div className="mt-4 space-y-3">
            {/* Existing Attributes */}
            {Object.entries(state.customAttributes).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(state.customAttributes).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between bg-gray-900 rounded px-3 py-2"
                  >
                    <span className="text-sm">
                      <span className="text-gray-400">{key}:</span>{' '}
                      <span className="text-white">{String(value)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeCustomAttribute(key)}
                      disabled={isDisabled}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50"
                      aria-label={`Remove ${key}`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No custom attributes</p>
            )}

            {/* Add New Attribute */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Key"
                value={newAttrKey}
                onChange={(e) => setNewAttrKey(e.target.value)}
                disabled={isDisabled}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                aria-label="New attribute key"
              />
              <input
                type="text"
                placeholder="Value"
                value={newAttrValue}
                onChange={(e) => setNewAttrValue(e.target.value)}
                disabled={isDisabled}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                aria-label="New attribute value"
              />
              <button
                type="button"
                onClick={addCustomAttribute}
                disabled={isDisabled || !newAttrKey.trim()}
                className="px-3 py-2 bg-amber-500 text-black font-medium rounded hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* State Summary */}
      <div className="bg-gray-900 rounded-lg p-4 text-sm">
        <h4 className="text-gray-400 font-medium mb-2">Current State Summary</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-amber-400">{state.bgt.toLocaleString()}</p>
            <p className="text-gray-500">BGT</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-400">{state.engagement}%</p>
            <p className="text-gray-500">Engagement</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-400">{state.tenureDays}</p>
            <p className="text-gray-500">Days</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-purple-400">
              {state.badges.length + state.nfts.length}
            </p>
            <p className="text-gray-500">Badges/NFTs</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StateEditor;
