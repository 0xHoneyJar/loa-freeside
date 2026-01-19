/**
 * Decision Trace Component
 *
 * Sprint 131: Restore Modal & QA Sandbox
 *
 * Shows why a permission was granted or denied with step-by-step trace.
 *
 * @module components/sandbox/DecisionTrace
 */

import React from 'react';

// =============================================================================
// Types
// =============================================================================

export type TraceStepResult = 'pass' | 'fail' | 'skip' | 'info';

export interface TraceStep {
  /** Step identifier */
  id: string;
  /** Step label */
  label: string;
  /** Step description */
  description: string;
  /** Step result */
  result: TraceStepResult;
  /** Value checked */
  checkedValue?: string | number;
  /** Required value */
  requiredValue?: string | number;
  /** Child steps for nested rules */
  children?: TraceStep[];
}

export interface DecisionTraceProps {
  /** Permission name being traced */
  permissionName: string;
  /** Final decision */
  decision: 'granted' | 'denied' | 'partial';
  /** Trace steps */
  steps: TraceStep[];
  /** Effective tier determined */
  effectiveTier?: string;
  /** Timestamp of the check */
  timestamp?: Date;
}

// =============================================================================
// Helper Functions
// =============================================================================

function getStepIcon(result: TraceStepResult): React.ReactNode {
  switch (result) {
    case 'pass':
      return (
        <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
          <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
    case 'fail':
      return (
        <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
          <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
    case 'skip':
      return (
        <div className="w-6 h-6 rounded-full bg-gray-500/20 flex items-center justify-center">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </div>
      );
    case 'info':
      return (
        <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      );
  }
}

function getStepColor(result: TraceStepResult): string {
  switch (result) {
    case 'pass':
      return 'border-green-500/30';
    case 'fail':
      return 'border-red-500/30';
    case 'skip':
      return 'border-gray-500/30';
    case 'info':
      return 'border-blue-500/30';
  }
}

function getDecisionColor(decision: 'granted' | 'denied' | 'partial'): string {
  switch (decision) {
    case 'granted':
      return 'bg-green-500';
    case 'denied':
      return 'bg-red-500';
    case 'partial':
      return 'bg-yellow-500';
  }
}

// =============================================================================
// Step Component
// =============================================================================

interface StepItemProps {
  step: TraceStep;
  depth?: number;
}

const StepItem: React.FC<StepItemProps> = ({ step, depth = 0 }) => {
  return (
    <div className={`${depth > 0 ? 'ml-6' : ''}`}>
      <div
        className={`flex items-start gap-3 p-3 rounded-lg border ${getStepColor(step.result)} bg-gray-800/50`}
      >
        {getStepIcon(step.result)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="font-medium text-white">{step.label}</p>
            {(step.checkedValue !== undefined || step.requiredValue !== undefined) && (
              <div className="flex items-center gap-2 text-xs">
                {step.checkedValue !== undefined && (
                  <span className="px-2 py-0.5 rounded bg-gray-900 text-gray-300">
                    Got: {String(step.checkedValue)}
                  </span>
                )}
                {step.requiredValue !== undefined && (
                  <span className="px-2 py-0.5 rounded bg-gray-900 text-gray-300">
                    Need: {String(step.requiredValue)}
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">{step.description}</p>
        </div>
      </div>

      {/* Child steps */}
      {step.children && step.children.length > 0 && (
        <div className="mt-2 space-y-2 relative">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-700" />
          {step.children.map((child) => (
            <StepItem key={child.id} step={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const DecisionTrace: React.FC<DecisionTraceProps> = ({
  permissionName,
  decision,
  steps,
  effectiveTier,
  timestamp,
}) => {
  const passCount = steps.filter((s) => s.result === 'pass').length;
  const failCount = steps.filter((s) => s.result === 'fail').length;

  return (
    <div className="bg-gray-900 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-white flex items-center gap-2">
            Decision Trace
            <span
              className={`w-2 h-2 rounded-full ${getDecisionColor(decision)}`}
              title={decision}
            />
          </h3>
          <p className="text-sm text-gray-400">{permissionName}</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-bold capitalize ${
            decision === 'granted' ? 'text-green-400' :
            decision === 'denied' ? 'text-red-400' : 'text-yellow-400'
          }`}>
            {decision}
          </p>
          {timestamp && (
            <p className="text-xs text-gray-500">
              {timestamp.toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="text-green-400 font-medium">{passCount}</span>
              <span className="text-gray-500 text-sm">passed</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-red-400 font-medium">{failCount}</span>
              <span className="text-gray-500 text-sm">failed</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-400 font-medium">{steps.length}</span>
              <span className="text-gray-500 text-sm">total checks</span>
            </div>
          </div>
          {effectiveTier && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">Effective Tier:</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-sm font-medium">
                {effectiveTier}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="p-4 space-y-3">
        {steps.length === 0 ? (
          <div className="text-center py-4 text-gray-500">
            <p>No trace steps available</p>
          </div>
        ) : (
          steps.map((step) => (
            <StepItem key={step.id} step={step} />
          ))
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-3 bg-gray-800/30 border-t border-gray-800">
        <div className="flex items-center justify-center gap-6 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-green-500/20" />
            <span>Pass</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-red-500/20" />
            <span>Fail</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-gray-500/20" />
            <span>Skip</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-blue-500/20" />
            <span>Info</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DecisionTrace;
