/**
 * QA Sandbox Page
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Main page for testing permission configurations with simulated user states.
 *
 * @module pages/Sandbox
 */

import React, { useState, useCallback, useMemo } from 'react';
import StateEditor, { type UserState } from '../components/sandbox/StateEditor';
import PermissionResult, { type PermissionCheck } from '../components/sandbox/PermissionResult';
import DecisionTrace, { type TraceStep } from '../components/sandbox/DecisionTrace';

// =============================================================================
// Types
// =============================================================================

export interface TierOverride {
  enabled: boolean;
  tierId: string;
  tierName: string;
}

export interface SandboxPageProps {
  /** Available tiers for override dropdown */
  availableTiers?: Array<{ id: string; name: string; level: number }>;
  /** Function to run permission check */
  onCheckPermissions?: (state: UserState, tierOverride?: string) => Promise<PermissionCheck[]>;
  /** Function to get decision trace for a permission */
  onGetTrace?: (permissionId: string, state: UserState) => Promise<{
    decision: 'granted' | 'denied' | 'partial';
    steps: TraceStep[];
    effectiveTier: string;
  }>;
}

// =============================================================================
// Default Data
// =============================================================================

const DEFAULT_TIERS = [
  { id: 'wanderer', name: 'Wanderer', level: 0 },
  { id: 'initiate', name: 'Initiate', level: 1 },
  { id: 'fremen', name: 'Fremen', level: 2 },
  { id: 'naib', name: 'Naib', level: 3 },
];

const DEFAULT_STATE: UserState = {
  bgt: 0,
  engagement: 0,
  tenureDays: 0,
  badges: [],
  nfts: [],
  customAttributes: {},
};

// Mock permission check for demo
const mockCheckPermissions = async (state: UserState, tierOverride?: string): Promise<PermissionCheck[]> => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500));

  const effectiveTier = tierOverride || (
    state.bgt >= 10000 ? 'naib' :
    state.bgt >= 1000 ? 'fremen' :
    state.bgt >= 100 ? 'initiate' : 'wanderer'
  );

  return [
    {
      id: 'channel-general',
      name: 'General Chat',
      category: 'channels',
      status: 'granted',
      reason: 'Available to all tiers',
      requiredTier: 'wanderer',
      userTier: effectiveTier,
    },
    {
      id: 'channel-trading',
      name: 'Trading Discussion',
      category: 'channels',
      status: effectiveTier === 'naib' || effectiveTier === 'fremen' ? 'granted' : 'denied',
      reason: effectiveTier === 'naib' || effectiveTier === 'fremen'
        ? `${effectiveTier} tier has access`
        : 'Requires Fremen tier or above',
      requiredTier: 'fremen',
      userTier: effectiveTier,
    },
    {
      id: 'channel-alpha',
      name: 'Alpha Signals',
      category: 'channels',
      status: effectiveTier === 'naib' ? 'granted' : 'denied',
      reason: effectiveTier === 'naib' ? 'Naib tier has access' : 'Requires Naib tier',
      requiredTier: 'naib',
      userTier: effectiveTier,
    },
    {
      id: 'feature-emoji',
      name: 'Custom Emojis',
      category: 'features',
      status: effectiveTier !== 'wanderer' ? 'granted' : 'denied',
      reason: effectiveTier !== 'wanderer' ? 'Tier requirement met' : 'Requires Initiate tier or above',
      requiredTier: 'initiate',
      userTier: effectiveTier,
    },
    {
      id: 'feature-voice',
      name: 'Voice Channels',
      category: 'features',
      status: effectiveTier === 'naib' || effectiveTier === 'fremen' ? 'granted' : 'denied',
      reason: effectiveTier === 'naib' || effectiveTier === 'fremen'
        ? 'Tier requirement met'
        : 'Requires Fremen tier or above',
      requiredTier: 'fremen',
      userTier: effectiveTier,
    },
    {
      id: 'command-giveaway',
      name: '/giveaway Command',
      category: 'commands',
      status: state.badges.includes('event-participant') || effectiveTier === 'naib' ? 'granted' : 'denied',
      reason: state.badges.includes('event-participant')
        ? 'Has event-participant badge'
        : effectiveTier === 'naib'
        ? 'Naib tier has access'
        : 'Requires event-participant badge or Naib tier',
      requiredTier: 'naib',
      userTier: effectiveTier,
    },
  ];
};

// Mock trace for demo
const mockGetTrace = async (permissionId: string, state: UserState): Promise<{
  decision: 'granted' | 'denied' | 'partial';
  steps: TraceStep[];
  effectiveTier: string;
}> => {
  await new Promise((resolve) => setTimeout(resolve, 300));

  const effectiveTier = state.bgt >= 10000 ? 'naib' :
    state.bgt >= 1000 ? 'fremen' :
    state.bgt >= 100 ? 'initiate' : 'wanderer';

  const isGranted = permissionId === 'channel-general' ||
    (permissionId === 'channel-trading' && (effectiveTier === 'naib' || effectiveTier === 'fremen')) ||
    (permissionId === 'feature-emoji' && effectiveTier !== 'wanderer');

  return {
    decision: isGranted ? 'granted' : 'denied',
    effectiveTier,
    steps: [
      {
        id: 'step-1',
        label: 'Calculate Effective Tier',
        description: 'Determine user tier based on BGT holdings',
        result: 'info',
        checkedValue: state.bgt,
        requiredValue: 'N/A',
      },
      {
        id: 'step-2',
        label: 'Check Tier Requirement',
        description: 'Verify user tier meets minimum requirement',
        result: isGranted ? 'pass' : 'fail',
        checkedValue: effectiveTier,
        requiredValue: permissionId === 'channel-general' ? 'wanderer' : 'fremen',
      },
      {
        id: 'step-3',
        label: 'Check OR Conditions',
        description: 'Check for alternative access methods (badges, NFTs)',
        result: state.badges.length > 0 ? 'pass' : 'skip',
        children: state.badges.length > 0 ? [
          {
            id: 'step-3a',
            label: 'Badge Check',
            description: `User has ${state.badges.length} badge(s)`,
            result: 'pass',
            checkedValue: state.badges.join(', '),
          },
        ] : undefined,
      },
      {
        id: 'step-4',
        label: 'Final Decision',
        description: isGranted ? 'All requirements met' : 'Requirements not met',
        result: isGranted ? 'pass' : 'fail',
      },
    ],
  };
};

// =============================================================================
// Main Component
// =============================================================================

export const SandboxPage: React.FC<SandboxPageProps> = ({
  availableTiers = DEFAULT_TIERS,
  onCheckPermissions = mockCheckPermissions,
  onGetTrace = mockGetTrace,
}) => {
  // State
  const [userState, setUserState] = useState<UserState>(DEFAULT_STATE);
  const [tierOverride, setTierOverride] = useState<TierOverride>({
    enabled: false,
    tierId: '',
    tierName: '',
  });
  const [permissions, setPermissions] = useState<PermissionCheck[]>([]);
  const [selectedPermission, setSelectedPermission] = useState<string | null>(null);
  const [trace, setTrace] = useState<{
    decision: 'granted' | 'denied' | 'partial';
    steps: TraceStep[];
    effectiveTier: string;
  } | null>(null);
  const [filter, setFilter] = useState<'all' | 'granted' | 'denied'>('all');
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(false);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sorted tiers (highest level first)
  const sortedTiers = useMemo(
    () => [...availableTiers].sort((a, b) => b.level - a.level),
    [availableTiers]
  );

  // Check permissions
  const handleCheckPermissions = useCallback(async () => {
    setIsCheckingPermissions(true);
    setError(null);
    setSelectedPermission(null);
    setTrace(null);

    try {
      const results = await onCheckPermissions(
        userState,
        tierOverride.enabled ? tierOverride.tierId : undefined
      );
      setPermissions(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check permissions');
    } finally {
      setIsCheckingPermissions(false);
    }
  }, [userState, tierOverride, onCheckPermissions]);

  // Get trace for a permission
  const handleSelectPermission = useCallback(async (permissionId: string) => {
    setSelectedPermission(permissionId);
    setIsLoadingTrace(true);

    try {
      const result = await onGetTrace(permissionId, userState);
      setTrace(result);
    } catch (err) {
      setTrace(null);
    } finally {
      setIsLoadingTrace(false);
    }
  }, [userState, onGetTrace]);

  // Handle tier override toggle
  const handleTierOverrideToggle = useCallback((enabled: boolean) => {
    if (enabled && !tierOverride.tierId && sortedTiers.length > 0) {
      setTierOverride({
        enabled: true,
        tierId: sortedTiers[0].id,
        tierName: sortedTiers[0].name,
      });
    } else {
      setTierOverride((prev) => ({ ...prev, enabled }));
    }
  }, [tierOverride.tierId, sortedTiers]);

  // Handle tier override change
  const handleTierOverrideChange = useCallback((tierId: string) => {
    const tier = availableTiers.find((t) => t.id === tierId);
    if (tier) {
      setTierOverride({
        enabled: true,
        tierId: tier.id,
        tierName: tier.name,
      });
    }
  }, [availableTiers]);

  // Get selected permission details
  const selectedPermissionDetails = useMemo(
    () => permissions.find((p) => p.id === selectedPermission),
    [permissions, selectedPermission]
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold">QA Sandbox</h1>
          <p className="text-gray-400 mt-1">
            Test permission configurations with simulated user states
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: State Editor */}
          <div className="space-y-6">
            {/* Tier Override */}
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium text-white">Tier Override</h2>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tierOverride.enabled}
                    onChange={(e) => handleTierOverrideToggle(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 text-amber-500 focus:ring-amber-500 bg-gray-800"
                  />
                  <span className="text-sm text-gray-400">Enable Override</span>
                </label>
              </div>

              {tierOverride.enabled && (
                <div className="flex items-center gap-3">
                  <label htmlFor="tier-override" className="text-sm text-gray-400">
                    Assume Tier:
                  </label>
                  <select
                    id="tier-override"
                    value={tierOverride.tierId}
                    onChange={(e) => handleTierOverrideChange(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {sortedTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name} (Level {tier.level})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {tierOverride.enabled && (
                <p className="text-xs text-amber-400 mt-2">
                  Permission checks will use {tierOverride.tierName} tier instead of calculated tier
                </p>
              )}
            </div>

            {/* State Editor */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="font-medium text-white mb-4">User State</h2>
              <StateEditor
                state={userState}
                onChange={setUserState}
                isLoading={isCheckingPermissions}
              />
            </div>

            {/* Check Button */}
            <button
              onClick={handleCheckPermissions}
              disabled={isCheckingPermissions}
              className="w-full py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isCheckingPermissions ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Checking...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Check Permissions
                </>
              )}
            </button>
          </div>

          {/* Right Column: Results */}
          <div className="space-y-6">
            {/* Filter Tabs */}
            <div className="flex gap-2">
              {(['all', 'granted', 'denied'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === f
                      ? 'bg-amber-500 text-black'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {/* Permission Results */}
            <PermissionResult
              permissions={permissions}
              selected={selectedPermission || undefined}
              onSelect={handleSelectPermission}
              filter={filter}
              isLoading={isCheckingPermissions}
              error={error || undefined}
            />

            {/* Decision Trace */}
            {selectedPermissionDetails && (
              <div className="mt-6">
                {isLoadingTrace ? (
                  <div className="bg-gray-900 rounded-lg p-8 flex items-center justify-center">
                    <svg className="animate-spin h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                ) : trace ? (
                  <DecisionTrace
                    permissionName={selectedPermissionDetails.name}
                    decision={trace.decision}
                    steps={trace.steps}
                    effectiveTier={trace.effectiveTier}
                    timestamp={new Date()}
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SandboxPage;
