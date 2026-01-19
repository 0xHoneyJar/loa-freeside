/**
 * Role Mapping Table Component
 *
 * Sprint 130: Role Mapping & History
 *
 * Displays and manages Discord role to tier mappings.
 * Supports drag-to-reorder, ghost role detection, and Discord role picker.
 *
 * @module components/config/RoleMappingTable
 */

import React, { useState, useCallback, useMemo } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface RoleMapping {
  id: string;
  discordRoleId: string;
  discordRoleName: string;
  discordRoleColor?: string;
  tierId: string;
  tierName: string;
  priority: number;
  /** True if Discord role no longer exists */
  isGhost?: boolean;
}

export interface DiscordRole {
  id: string;
  name: string;
  color?: string;
  position: number;
}

export interface TierOption {
  id: string;
  name: string;
  level: number;
}

export interface RoleMappingTableProps {
  /** Current role mappings */
  mappings: RoleMapping[];
  /** Available Discord roles */
  discordRoles: DiscordRole[];
  /** Available tiers */
  tiers: TierOption[];
  /** Callback when mappings change */
  onUpdate: (mappings: RoleMapping[]) => void;
  /** Callback to fetch Discord roles */
  onFetchRoles?: () => Promise<DiscordRole[]>;
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string;
  /** Disable all interactions */
  disabled?: boolean;
}

// =============================================================================
// Helper Components
// =============================================================================

interface RolePickerProps {
  selectedRoleId: string | null;
  roles: DiscordRole[];
  onSelect: (role: DiscordRole) => void;
  onClose: () => void;
  excludeIds?: string[];
}

const RolePicker: React.FC<RolePickerProps> = ({
  selectedRoleId,
  roles,
  onSelect,
  onClose,
  excludeIds = [],
}) => {
  const [search, setSearch] = useState('');

  const filteredRoles = useMemo(() => {
    const available = roles.filter((r) => !excludeIds.includes(r.id));
    if (!search) return available;
    return available.filter((r) =>
      r.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [roles, excludeIds, search]);

  return (
    <div className="absolute z-50 top-full left-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
      <div className="p-2 border-b border-gray-700">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search roles..."
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
          aria-label="Search Discord roles"
          autoFocus
        />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filteredRoles.length === 0 ? (
          <div className="p-3 text-center text-gray-500 text-sm">
            No roles found
          </div>
        ) : (
          filteredRoles.map((role) => (
            <button
              key={role.id}
              onClick={() => {
                onSelect(role);
                onClose();
              }}
              className={`
                w-full px-3 py-2 text-left flex items-center gap-2
                hover:bg-gray-700 transition-colors
                ${selectedRoleId === role.id ? 'bg-gray-700' : ''}
              `}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: role.color || '#99aab5' }}
              />
              <span className="text-white text-sm">{role.name}</span>
            </button>
          ))
        )}
      </div>
      <div className="p-2 border-t border-gray-700">
        <button
          onClick={onClose}
          className="w-full px-3 py-1.5 text-gray-400 text-sm hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

interface MappingRowProps {
  mapping: RoleMapping;
  tiers: TierOption[];
  discordRoles: DiscordRole[];
  mappedRoleIds: string[];
  onUpdate: (mapping: RoleMapping) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  disabled?: boolean;
  isFirst: boolean;
  isLast: boolean;
}

const MappingRow: React.FC<MappingRowProps> = ({
  mapping,
  tiers,
  discordRoles,
  mappedRoleIds,
  onUpdate,
  onDelete,
  onMove,
  disabled = false,
  isFirst,
  isLast,
}) => {
  const [showRolePicker, setShowRolePicker] = useState(false);

  return (
    <tr
      className={`
        ${mapping.isGhost ? 'bg-red-900/20' : 'hover:bg-gray-800/50'}
        border-b border-gray-800
      `}
    >
      {/* Priority Controls */}
      <td className="px-4 py-3 w-20">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => onMove(mapping.id, 'up')}
            disabled={disabled || isFirst}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={`Move ${mapping.discordRoleName} up`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <span className="text-center text-xs text-gray-500">{mapping.priority}</span>
          <button
            onClick={() => onMove(mapping.id, 'down')}
            disabled={disabled || isLast}
            className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={`Move ${mapping.discordRoleName} down`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </td>

      {/* Discord Role */}
      <td className="px-4 py-3 relative">
        <button
          onClick={() => !disabled && setShowRolePicker(!showRolePicker)}
          disabled={disabled}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded border
            ${mapping.isGhost
              ? 'border-red-500 bg-red-900/20'
              : 'border-gray-700 bg-gray-800 hover:border-gray-600'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
          aria-label={`Select Discord role, current: ${mapping.discordRoleName}`}
        >
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: mapping.discordRoleColor || '#99aab5' }}
          />
          <span className={mapping.isGhost ? 'text-red-400' : 'text-white'}>
            {mapping.discordRoleName}
          </span>
          {mapping.isGhost && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-900 text-red-300 rounded">
              GHOST
            </span>
          )}
        </button>
        {showRolePicker && (
          <RolePicker
            selectedRoleId={mapping.discordRoleId}
            roles={discordRoles}
            excludeIds={mappedRoleIds.filter((id) => id !== mapping.discordRoleId)}
            onSelect={(role) => {
              onUpdate({
                ...mapping,
                discordRoleId: role.id,
                discordRoleName: role.name,
                discordRoleColor: role.color,
                isGhost: false,
              });
            }}
            onClose={() => setShowRolePicker(false)}
          />
        )}
      </td>

      {/* Tier */}
      <td className="px-4 py-3">
        <select
          value={mapping.tierId}
          onChange={(e) => {
            const tier = tiers.find((t) => t.id === e.target.value);
            if (tier) {
              onUpdate({
                ...mapping,
                tierId: tier.id,
                tierName: tier.name,
              });
            }
          }}
          disabled={disabled}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 disabled:opacity-50"
          aria-label={`Select tier for ${mapping.discordRoleName}`}
        >
          {tiers.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.name} (Level {tier.level})
            </option>
          ))}
        </select>
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right">
        <button
          onClick={() => onDelete(mapping.id)}
          disabled={disabled}
          className="p-2 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
          aria-label={`Delete mapping for ${mapping.discordRoleName}`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </td>
    </tr>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const RoleMappingTable: React.FC<RoleMappingTableProps> = ({
  mappings,
  discordRoles,
  tiers,
  onUpdate,
  onFetchRoles,
  isLoading = false,
  error,
  disabled = false,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddPicker, setShowAddPicker] = useState(false);

  // Sort mappings by priority
  const sortedMappings = useMemo(
    () => [...mappings].sort((a, b) => a.priority - b.priority),
    [mappings]
  );

  // Get already mapped role IDs
  const mappedRoleIds = useMemo(
    () => mappings.map((m) => m.discordRoleId),
    [mappings]
  );

  // Count ghost roles
  const ghostCount = useMemo(
    () => mappings.filter((m) => m.isGhost).length,
    [mappings]
  );

  const handleUpdateMapping = useCallback(
    (updated: RoleMapping) => {
      const newMappings = mappings.map((m) =>
        m.id === updated.id ? updated : m
      );
      onUpdate(newMappings);
    },
    [mappings, onUpdate]
  );

  const handleDeleteMapping = useCallback(
    (id: string) => {
      const newMappings = mappings.filter((m) => m.id !== id);
      // Recalculate priorities
      const reordered = newMappings
        .sort((a, b) => a.priority - b.priority)
        .map((m, i) => ({ ...m, priority: i + 1 }));
      onUpdate(reordered);
    },
    [mappings, onUpdate]
  );

  const handleMoveMapping = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const sorted = [...mappings].sort((a, b) => a.priority - b.priority);
      const index = sorted.findIndex((m) => m.id === id);
      if (index === -1) return;

      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= sorted.length) return;

      // Swap priorities
      const current = sorted[index];
      const other = sorted[newIndex];
      const newMappings = mappings.map((m) => {
        if (m.id === current.id) return { ...m, priority: other.priority };
        if (m.id === other.id) return { ...m, priority: current.priority };
        return m;
      });

      onUpdate(newMappings);
    },
    [mappings, onUpdate]
  );

  const handleAddMapping = useCallback(
    (role: DiscordRole) => {
      const defaultTier = tiers[0];
      if (!defaultTier) return;

      const newMapping: RoleMapping = {
        id: `mapping-${Date.now()}`,
        discordRoleId: role.id,
        discordRoleName: role.name,
        discordRoleColor: role.color,
        tierId: defaultTier.id,
        tierName: defaultTier.name,
        priority: mappings.length + 1,
      };

      onUpdate([...mappings, newMapping]);
      setShowAddPicker(false);
    },
    [mappings, tiers, onUpdate]
  );

  const handleRefreshRoles = useCallback(async () => {
    if (!onFetchRoles) return;
    setIsRefreshing(true);
    try {
      await onFetchRoles();
    } finally {
      setIsRefreshing(false);
    }
  }, [onFetchRoles]);

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Role Mappings</h2>
          <p className="text-sm text-gray-400">
            Map Discord roles to tiers. Higher priority mappings are checked first.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {onFetchRoles && (
            <button
              onClick={handleRefreshRoles}
              disabled={disabled || isRefreshing}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 flex items-center gap-2"
            >
              <svg
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh Roles
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowAddPicker(!showAddPicker)}
              disabled={disabled}
              className="px-4 py-2 bg-amber-500 text-black font-medium rounded-lg hover:bg-amber-400 disabled:opacity-50"
            >
              Add Mapping
            </button>
            {showAddPicker && (
              <RolePicker
                selectedRoleId={null}
                roles={discordRoles}
                excludeIds={mappedRoleIds}
                onSelect={handleAddMapping}
                onClose={() => setShowAddPicker(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Ghost Role Warning */}
      {ghostCount > 0 && (
        <div
          className="flex items-center gap-3 p-3 bg-red-900/20 border border-red-500/30 rounded-lg"
          role="alert"
        >
          <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-red-400">
            {ghostCount} ghost role{ghostCount > 1 ? 's' : ''} detected. These roles no longer exist in Discord.
          </span>
        </div>
      )}

      {/* Table */}
      {sortedMappings.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">No role mappings configured</p>
          <p className="text-sm text-gray-500 mt-2">
            Click &quot;Add Mapping&quot; to create your first role mapping.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-800">
                <th className="px-4 py-3 text-left text-gray-400 font-medium border-b border-gray-700 w-20">
                  Priority
                </th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium border-b border-gray-700">
                  Discord Role
                </th>
                <th className="px-4 py-3 text-left text-gray-400 font-medium border-b border-gray-700">
                  Tier
                </th>
                <th className="px-4 py-3 text-right text-gray-400 font-medium border-b border-gray-700 w-20">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedMappings.map((mapping, index) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  tiers={tiers}
                  discordRoles={discordRoles}
                  mappedRoleIds={mappedRoleIds}
                  onUpdate={handleUpdateMapping}
                  onDelete={handleDeleteMapping}
                  onMove={handleMoveMapping}
                  disabled={disabled}
                  isFirst={index === 0}
                  isLast={index === sortedMappings.length - 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>Priority determines evaluation order. First matching role wins.</p>
        <p>
          <span className="inline-block px-1.5 py-0.5 bg-red-900 text-red-300 rounded mr-2 align-middle text-xs">
            GHOST
          </span>
          Role deleted from Discord but still mapped
        </p>
      </div>
    </div>
  );
};

export default RoleMappingTable;
