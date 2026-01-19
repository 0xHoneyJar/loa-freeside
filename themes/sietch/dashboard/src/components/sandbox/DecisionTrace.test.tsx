/**
 * DecisionTrace Component Tests
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Tests for decision trace functionality.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DecisionTrace, type TraceStep } from './DecisionTrace';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockSteps: TraceStep[] = [
  {
    id: 'step-1',
    label: 'Calculate Effective Tier',
    description: 'Determine user tier based on BGT holdings',
    result: 'info',
    checkedValue: 5000,
    requiredValue: 'N/A',
  },
  {
    id: 'step-2',
    label: 'Check Tier Requirement',
    description: 'Verify user tier meets minimum requirement',
    result: 'pass',
    checkedValue: 'fremen',
    requiredValue: 'fremen',
  },
  {
    id: 'step-3',
    label: 'Check OR Conditions',
    description: 'Check for alternative access methods',
    result: 'skip',
  },
  {
    id: 'step-4',
    label: 'Final Decision',
    description: 'All requirements met',
    result: 'pass',
  },
];

const stepsWithNested: TraceStep[] = [
  {
    id: 'step-1',
    label: 'Tier Check',
    description: 'Main tier validation',
    result: 'fail',
    children: [
      {
        id: 'step-1a',
        label: 'BGT Balance',
        description: 'Check BGT holdings',
        result: 'fail',
        checkedValue: 100,
        requiredValue: 1000,
      },
      {
        id: 'step-1b',
        label: 'Engagement',
        description: 'Check engagement score',
        result: 'pass',
        checkedValue: 80,
        requiredValue: 50,
      },
    ],
  },
];

// =============================================================================
// Tests
// =============================================================================

describe('DecisionTrace', () => {
  describe('rendering', () => {
    it('should render permission name', () => {
      render(
        <DecisionTrace
          permissionName="Trading Discussion"
          decision="granted"
          steps={mockSteps}
        />
      );

      expect(screen.getByText('Trading Discussion')).toBeInTheDocument();
    });

    it('should render decision verdict', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
        />
      );

      expect(screen.getByText('granted')).toBeInTheDocument();
    });

    it('should render all steps', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
        />
      );

      expect(screen.getByText('Calculate Effective Tier')).toBeInTheDocument();
      expect(screen.getByText('Check Tier Requirement')).toBeInTheDocument();
      expect(screen.getByText('Check OR Conditions')).toBeInTheDocument();
      expect(screen.getByText('Final Decision')).toBeInTheDocument();
    });

    it('should render step descriptions', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
        />
      );

      expect(screen.getByText('Determine user tier based on BGT holdings')).toBeInTheDocument();
      expect(screen.getByText('Verify user tier meets minimum requirement')).toBeInTheDocument();
    });

    it('should render effective tier when provided', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
          effectiveTier="fremen"
        />
      );

      expect(screen.getByText('Effective Tier:')).toBeInTheDocument();
      expect(screen.getByText('fremen')).toBeInTheDocument();
    });

    it('should render timestamp when provided', () => {
      const testDate = new Date('2025-01-15T10:30:00');
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
          timestamp={testDate}
        />
      );

      // Use regex to handle case-insensitive AM/PM
      expect(screen.getByText(/10:30:00\s*[aApP][mM]/)).toBeInTheDocument();
    });

    it('should render empty state when no steps', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="denied"
          steps={[]}
        />
      );

      expect(screen.getByText('No trace steps available')).toBeInTheDocument();
    });
  });

  describe('step results', () => {
    it('should show pass count', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
        />
      );

      // 2 pass, 0 fail (skip and info don't count as pass/fail)
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('passed')).toBeInTheDocument();
    });

    it('should show fail count', () => {
      const failingSteps: TraceStep[] = [
        { id: 's1', label: 'Step 1', description: 'Desc', result: 'fail' },
        { id: 's2', label: 'Step 2', description: 'Desc', result: 'fail' },
      ];

      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="denied"
          steps={failingSteps}
        />
      );

      expect(screen.getByText('failed')).toBeInTheDocument();
    });

    it('should show total checks', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
        />
      );

      expect(screen.getByText('4')).toBeInTheDocument();
      expect(screen.getByText('total checks')).toBeInTheDocument();
    });
  });

  describe('checked/required values', () => {
    it('should show checked value', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
        />
      );

      expect(screen.getByText('Got: 5000')).toBeInTheDocument();
      expect(screen.getByText('Got: fremen')).toBeInTheDocument();
    });

    it('should show required value', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
        />
      );

      expect(screen.getByText('Need: N/A')).toBeInTheDocument();
      expect(screen.getByText('Need: fremen')).toBeInTheDocument();
    });
  });

  describe('nested steps', () => {
    it('should render child steps', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="denied"
          steps={stepsWithNested}
        />
      );

      expect(screen.getByText('Tier Check')).toBeInTheDocument();
      expect(screen.getByText('BGT Balance')).toBeInTheDocument();
      expect(screen.getByText('Engagement')).toBeInTheDocument();
    });

    it('should show nested step values', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="denied"
          steps={stepsWithNested}
        />
      );

      expect(screen.getByText('Got: 100')).toBeInTheDocument();
      expect(screen.getByText('Need: 1000')).toBeInTheDocument();
    });
  });

  describe('decision colors', () => {
    it('should use green for granted', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
        />
      );

      const verdict = screen.getByText('granted');
      expect(verdict).toHaveClass('text-green-400');
    });

    it('should use red for denied', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="denied"
          steps={[]}
        />
      );

      const verdict = screen.getByText('denied');
      expect(verdict).toHaveClass('text-red-400');
    });

    it('should use yellow for partial', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="partial"
          steps={[]}
        />
      );

      const verdict = screen.getByText('partial');
      expect(verdict).toHaveClass('text-yellow-400');
    });
  });

  describe('legend', () => {
    it('should render legend with all status types', () => {
      render(
        <DecisionTrace
          permissionName="Test Permission"
          decision="granted"
          steps={mockSteps}
        />
      );

      expect(screen.getByText('Pass')).toBeInTheDocument();
      expect(screen.getByText('Fail')).toBeInTheDocument();
      expect(screen.getByText('Skip')).toBeInTheDocument();
      expect(screen.getByText('Info')).toBeInTheDocument();
    });
  });
});
