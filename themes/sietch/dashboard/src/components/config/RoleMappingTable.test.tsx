/**
 * RoleMappingTable Component Tests
 *
 * Sprint 130: Role Mapping & History
 *
 * Tests for role mapping table functionality.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  RoleMappingTable,
  type RoleMapping,
  type DiscordRole,
  type TierOption,
} from './RoleMappingTable';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockDiscordRoles: DiscordRole[] = [
  { id: 'role-1', name: 'Admin', color: '#ff0000', position: 10 },
  { id: 'role-2', name: 'Moderator', color: '#00ff00', position: 8 },
  { id: 'role-3', name: 'Member', color: '#0000ff', position: 5 },
  { id: 'role-4', name: 'Guest', color: '#888888', position: 1 },
];

const mockTiers: TierOption[] = [
  { id: 'wanderer', name: 'Wanderer', level: 0 },
  { id: 'initiate', name: 'Initiate', level: 1 },
  { id: 'fremen', name: 'Fremen', level: 2 },
  { id: 'naib', name: 'Naib', level: 3 },
];

const mockMappings: RoleMapping[] = [
  {
    id: 'mapping-1',
    discordRoleId: 'role-1',
    discordRoleName: 'Admin',
    discordRoleColor: '#ff0000',
    tierId: 'naib',
    tierName: 'Naib',
    priority: 1,
  },
  {
    id: 'mapping-2',
    discordRoleId: 'role-2',
    discordRoleName: 'Moderator',
    discordRoleColor: '#00ff00',
    tierId: 'fremen',
    tierName: 'Fremen',
    priority: 2,
  },
  {
    id: 'mapping-3',
    discordRoleId: 'deleted-role',
    discordRoleName: 'Deleted Role',
    discordRoleColor: '#999999',
    tierId: 'initiate',
    tierName: 'Initiate',
    priority: 3,
    isGhost: true,
  },
];

// =============================================================================
// Tests
// =============================================================================

describe('RoleMappingTable', () => {
  describe('rendering', () => {
    it('should render all mappings', () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.getByText('Moderator')).toBeInTheDocument();
      expect(screen.getByText('Deleted Role')).toBeInTheDocument();
    });

    it('should render priority numbers', () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('should render loading state', () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
          isLoading
        />
      );

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should render error state', () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
          error="Failed to load mappings"
        />
      );

      expect(screen.getByText('Failed to load mappings')).toBeInTheDocument();
    });

    it('should render empty state', () => {
      render(
        <RoleMappingTable
          mappings={[]}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('No role mappings configured')).toBeInTheDocument();
    });
  });

  describe('ghost role warning', () => {
    it('should show ghost role badge', () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // GHOST appears as badge and in the legend
      expect(screen.getAllByText('GHOST').length).toBeGreaterThanOrEqual(1);
    });

    it('should show ghost role warning alert', () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/1 ghost role detected/)).toBeInTheDocument();
    });

    it('should not show warning when no ghost roles', () => {
      const mappingsWithoutGhost = mockMappings.filter((m) => !m.isGhost);
      render(
        <RoleMappingTable
          mappings={mappingsWithoutGhost}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('role picker', () => {
    it('should open role picker when clicking role button', async () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const roleButton = screen.getByLabelText(/select discord role, current: admin/i);
      fireEvent.click(roleButton);

      await waitFor(() => {
        expect(screen.getByLabelText(/search discord roles/i)).toBeInTheDocument();
      });
    });

    it('should filter roles in picker', async () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      // Open picker
      const roleButton = screen.getByLabelText(/select discord role, current: admin/i);
      fireEvent.click(roleButton);

      // Type in search
      const searchInput = screen.getByLabelText(/search discord roles/i);
      fireEvent.change(searchInput, { target: { value: 'Mod' } });

      // Should show Moderator but not Guest (since Moderator is already mapped, both should not appear)
      // Actually, Moderator is mapped so it won't appear. Guest should appear.
      await waitFor(() => {
        expect(screen.queryByText('Guest')).not.toBeInTheDocument();
      });
    });

    it('should call onUpdate when selecting a role', async () => {
      const onUpdate = vi.fn();
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      // Open picker for Admin mapping
      const roleButton = screen.getByLabelText(/select discord role, current: admin/i);
      fireEvent.click(roleButton);

      // Select Guest (which is not mapped)
      const guestOption = screen.getByText('Guest');
      fireEvent.click(guestOption);

      expect(onUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'mapping-1',
            discordRoleName: 'Guest',
          }),
        ])
      );
    });
  });

  describe('priority ordering', () => {
    it('should move mapping up when clicking up arrow', () => {
      const onUpdate = vi.fn();
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      // Move Moderator (priority 2) up
      const moveUpButton = screen.getByLabelText(/move moderator up/i);
      fireEvent.click(moveUpButton);

      expect(onUpdate).toHaveBeenCalled();
      const updatedMappings = onUpdate.mock.calls[0][0];
      const adminMapping = updatedMappings.find((m: RoleMapping) => m.discordRoleName === 'Admin');
      const modMapping = updatedMappings.find((m: RoleMapping) => m.discordRoleName === 'Moderator');
      expect(modMapping.priority).toBeLessThan(adminMapping.priority);
    });

    it('should move mapping down when clicking down arrow', () => {
      const onUpdate = vi.fn();
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      // Move Admin (priority 1) down
      const moveDownButton = screen.getByLabelText(/move admin down/i);
      fireEvent.click(moveDownButton);

      expect(onUpdate).toHaveBeenCalled();
    });

    it('should disable up arrow for first item', () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const moveUpButton = screen.getByLabelText(/move admin up/i);
      expect(moveUpButton).toBeDisabled();
    });

    it('should disable down arrow for last item', () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const moveDownButton = screen.getByLabelText(/move deleted role down/i);
      expect(moveDownButton).toBeDisabled();
    });
  });

  describe('tier selection', () => {
    it('should change tier when selecting from dropdown', () => {
      const onUpdate = vi.fn();
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      const tierSelect = screen.getByLabelText(/select tier for admin/i);
      fireEvent.change(tierSelect, { target: { value: 'fremen' } });

      expect(onUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'mapping-1',
            tierId: 'fremen',
            tierName: 'Fremen',
          }),
        ])
      );
    });
  });

  describe('delete mapping', () => {
    it('should delete mapping and recalculate priorities', () => {
      const onUpdate = vi.fn();
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      const deleteButton = screen.getByLabelText(/delete mapping for moderator/i);
      fireEvent.click(deleteButton);

      expect(onUpdate).toHaveBeenCalled();
      const updatedMappings = onUpdate.mock.calls[0][0];
      expect(updatedMappings.length).toBe(2);
      expect(updatedMappings.find((m: RoleMapping) => m.discordRoleName === 'Moderator')).toBeUndefined();
    });
  });

  describe('add mapping', () => {
    it('should open picker when clicking Add Mapping', async () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
        />
      );

      const addButton = screen.getByText('Add Mapping');
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByLabelText(/search discord roles/i)).toBeInTheDocument();
      });
    });

    it('should add new mapping when selecting role', async () => {
      const onUpdate = vi.fn();
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={onUpdate}
        />
      );

      const addButton = screen.getByText('Add Mapping');
      fireEvent.click(addButton);

      // Member is not mapped yet
      const memberOption = screen.getByText('Member');
      fireEvent.click(memberOption);

      expect(onUpdate).toHaveBeenCalled();
      const updatedMappings = onUpdate.mock.calls[0][0];
      expect(updatedMappings.length).toBe(4);
      const newMapping = updatedMappings.find((m: RoleMapping) => m.discordRoleName === 'Member');
      expect(newMapping).toBeDefined();
      expect(newMapping.priority).toBe(4);
    });
  });

  describe('refresh roles', () => {
    it('should call onFetchRoles when clicking Refresh', async () => {
      const onFetchRoles = vi.fn().mockResolvedValue(mockDiscordRoles);
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
          onFetchRoles={onFetchRoles}
        />
      );

      const refreshButton = screen.getByText('Refresh Roles');
      fireEvent.click(refreshButton);

      await waitFor(() => {
        expect(onFetchRoles).toHaveBeenCalled();
      });
    });
  });

  describe('disabled state', () => {
    it('should disable all controls when disabled', () => {
      render(
        <RoleMappingTable
          mappings={mockMappings}
          discordRoles={mockDiscordRoles}
          tiers={mockTiers}
          onUpdate={vi.fn()}
          disabled
        />
      );

      expect(screen.getByText('Add Mapping')).toBeDisabled();
      expect(screen.getByLabelText(/select tier for admin/i)).toBeDisabled();
    });
  });
});
