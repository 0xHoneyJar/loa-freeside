/**
 * Sandbox Page Tests
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Tests for the QA sandbox page functionality.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SandboxPage } from './Sandbox';
import type { PermissionCheck } from '../components/sandbox/PermissionResult';
import type { TraceStep } from '../components/sandbox/DecisionTrace';
import type { UserState } from '../components/sandbox/StateEditor';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockPermissions: PermissionCheck[] = [
  {
    id: 'perm-1',
    name: 'General Chat',
    category: 'channels',
    status: 'granted',
    reason: 'Available to all',
    userTier: 'fremen',
  },
  {
    id: 'perm-2',
    name: 'Alpha Signals',
    category: 'channels',
    status: 'denied',
    reason: 'Requires Naib',
    userTier: 'fremen',
  },
];

const mockTrace = {
  decision: 'granted' as const,
  effectiveTier: 'fremen',
  steps: [
    {
      id: 'step-1',
      label: 'Tier Check',
      description: 'Validated tier',
      result: 'pass' as const,
    },
  ],
};

// =============================================================================
// Tests
// =============================================================================

describe('SandboxPage', () => {
  describe('rendering', () => {
    it('should render page header', () => {
      render(<SandboxPage />);

      expect(screen.getByText('QA Sandbox')).toBeInTheDocument();
      expect(screen.getByText(/test permission configurations/i)).toBeInTheDocument();
    });

    it('should render tier override section', () => {
      render(<SandboxPage />);

      expect(screen.getByText('Tier Override')).toBeInTheDocument();
      expect(screen.getByText('Enable Override')).toBeInTheDocument();
    });

    it('should render state editor', () => {
      render(<SandboxPage />);

      expect(screen.getByText('User State')).toBeInTheDocument();
      expect(screen.getByLabelText(/bgt balance/i)).toBeInTheDocument();
    });

    it('should render check permissions button', () => {
      render(<SandboxPage />);

      expect(screen.getByText('Check Permissions')).toBeInTheDocument();
    });

    it('should render filter tabs', () => {
      render(<SandboxPage />);

      expect(screen.getByText('All')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Granted' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Denied' })).toBeInTheDocument();
    });
  });

  describe('tier override', () => {
    it('should enable tier override dropdown when checked', () => {
      render(<SandboxPage />);

      const checkbox = screen.getByRole('checkbox', { name: /enable override/i });
      fireEvent.click(checkbox);

      expect(screen.getByLabelText(/assume tier/i)).toBeInTheDocument();
    });

    it('should show available tiers in dropdown', () => {
      render(<SandboxPage />);

      const checkbox = screen.getByRole('checkbox', { name: /enable override/i });
      fireEvent.click(checkbox);

      const dropdown = screen.getByLabelText(/assume tier/i);
      expect(dropdown).toBeInTheDocument();
      // Tiers appear in the dropdown options - use getAllByText since "Naib" may appear in multiple places
      expect(screen.getAllByText(/naib/i).length).toBeGreaterThanOrEqual(1);
    });

    it('should show warning when override enabled', () => {
      render(<SandboxPage />);

      const checkbox = screen.getByRole('checkbox', { name: /enable override/i });
      fireEvent.click(checkbox);

      expect(screen.getByText(/will use.*tier instead of calculated/i)).toBeInTheDocument();
    });
  });

  describe('permission checking', () => {
    it('should call onCheckPermissions when clicking button', async () => {
      const onCheckPermissions = vi.fn().mockResolvedValue(mockPermissions);
      render(<SandboxPage onCheckPermissions={onCheckPermissions} />);

      fireEvent.click(screen.getByText('Check Permissions'));

      await waitFor(() => {
        expect(onCheckPermissions).toHaveBeenCalled();
      });
    });

    it('should show loading state while checking', async () => {
      const onCheckPermissions = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockPermissions), 100))
      );
      render(<SandboxPage onCheckPermissions={onCheckPermissions} />);

      fireEvent.click(screen.getByText('Check Permissions'));

      expect(screen.getByText('Checking...')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByText('Checking...')).not.toBeInTheDocument();
      });
    });

    it('should display permission results after check', async () => {
      const onCheckPermissions = vi.fn().mockResolvedValue(mockPermissions);
      render(<SandboxPage onCheckPermissions={onCheckPermissions} />);

      fireEvent.click(screen.getByText('Check Permissions'));

      await waitFor(() => {
        expect(screen.getByText('General Chat')).toBeInTheDocument();
        expect(screen.getByText('Alpha Signals')).toBeInTheDocument();
      });
    });

    it('should pass tier override to check function', async () => {
      const onCheckPermissions = vi.fn().mockResolvedValue(mockPermissions);
      render(<SandboxPage onCheckPermissions={onCheckPermissions} />);

      // Enable tier override
      const checkbox = screen.getByRole('checkbox', { name: /enable override/i });
      fireEvent.click(checkbox);

      // Run check
      fireEvent.click(screen.getByText('Check Permissions'));

      await waitFor(() => {
        expect(onCheckPermissions).toHaveBeenCalledWith(
          expect.any(Object),
          expect.any(String)
        );
      });
    });
  });

  describe('filtering', () => {
    it('should filter results when clicking filter tab', async () => {
      const onCheckPermissions = vi.fn().mockResolvedValue(mockPermissions);
      render(<SandboxPage onCheckPermissions={onCheckPermissions} />);

      // Run check
      fireEvent.click(screen.getByText('Check Permissions'));

      await waitFor(() => {
        expect(screen.getByText('General Chat')).toBeInTheDocument();
      });

      // Filter to denied only
      fireEvent.click(screen.getByRole('button', { name: 'Denied' }));

      expect(screen.getByText('Alpha Signals')).toBeInTheDocument();
      expect(screen.queryByText('General Chat')).not.toBeInTheDocument();
    });
  });

  describe('decision trace', () => {
    it('should load trace when selecting a permission', async () => {
      const onCheckPermissions = vi.fn().mockResolvedValue(mockPermissions);
      const onGetTrace = vi.fn().mockResolvedValue(mockTrace);
      render(
        <SandboxPage
          onCheckPermissions={onCheckPermissions}
          onGetTrace={onGetTrace}
        />
      );

      // Run check
      fireEvent.click(screen.getByText('Check Permissions'));

      await waitFor(() => {
        expect(screen.getByText('General Chat')).toBeInTheDocument();
      });

      // Select a permission
      fireEvent.click(screen.getByText('General Chat'));

      await waitFor(() => {
        expect(onGetTrace).toHaveBeenCalledWith('perm-1', expect.any(Object));
      });
    });

    it('should display decision trace after loading', async () => {
      const onCheckPermissions = vi.fn().mockResolvedValue(mockPermissions);
      const onGetTrace = vi.fn().mockResolvedValue(mockTrace);
      render(
        <SandboxPage
          onCheckPermissions={onCheckPermissions}
          onGetTrace={onGetTrace}
        />
      );

      // Run check
      fireEvent.click(screen.getByText('Check Permissions'));

      await waitFor(() => {
        expect(screen.getByText('General Chat')).toBeInTheDocument();
      });

      // Select a permission
      fireEvent.click(screen.getByText('General Chat'));

      await waitFor(() => {
        expect(screen.getByText('Decision Trace')).toBeInTheDocument();
        expect(screen.getByText('Tier Check')).toBeInTheDocument();
      });
    });
  });

  describe('state editing', () => {
    it('should update state when editing BGT', async () => {
      const onCheckPermissions = vi.fn().mockResolvedValue(mockPermissions);
      render(<SandboxPage onCheckPermissions={onCheckPermissions} />);

      const bgtInput = screen.getByLabelText(/bgt balance/i);
      fireEvent.change(bgtInput, { target: { value: '5000' } });

      fireEvent.click(screen.getByText('Check Permissions'));

      await waitFor(() => {
        expect(onCheckPermissions).toHaveBeenCalledWith(
          expect.objectContaining({ bgt: 5000 }),
          undefined
        );
      });
    });

    it('should apply scenario template', async () => {
      const onCheckPermissions = vi.fn().mockResolvedValue(mockPermissions);
      render(<SandboxPage onCheckPermissions={onCheckPermissions} />);

      // Apply Whale template
      fireEvent.click(screen.getByText('Whale'));

      fireEvent.click(screen.getByText('Check Permissions'));

      await waitFor(() => {
        expect(onCheckPermissions).toHaveBeenCalledWith(
          expect.objectContaining({ bgt: 50000 }),
          undefined
        );
      });
    });
  });

  describe('default mock behavior', () => {
    it('should work with default mock handlers', async () => {
      render(<SandboxPage />);

      fireEvent.click(screen.getByText('Check Permissions'));

      await waitFor(() => {
        expect(screen.getByText('General Chat')).toBeInTheDocument();
      });
    });
  });
});
