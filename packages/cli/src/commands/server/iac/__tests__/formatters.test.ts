/**
 * Output Formatters Tests
 *
 * Sprint 101: Polish & Documentation
 *
 * Unit tests for CLI output formatters.
 *
 * @module packages/cli/commands/server/iac/__tests__/formatters.test
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Symbols,
  getOperationSymbol,
  colorByOperation,
  formatPlan,
  formatPlanSummary,
  formatResourceChange,
  formatPermissionChange,
  formatApplyResult,
  formatDestroyResult,
  formatStateList,
  Spinner,
  createSpinner,
  formatTimestamp,
  formatDuration,
  formatBytes,
  truncate,
  center,
  box,
  formatJson,
  jsonSuccess,
  jsonError,
} from '../formatters.js';
import type { ServerDiff, ResourceChange, PermissionChange, ApplyBatchResult } from '../types.js';
import type { GaibState } from '../backends/types.js';

describe('Symbols', () => {
  it('has all required symbols', () => {
    expect(Symbols.create).toBe('+');
    expect(Symbols.update).toBe('~');
    expect(Symbols.delete).toBe('-');
    expect(Symbols.noop).toBe(' ');
    expect(Symbols.success).toBeDefined();
    expect(Symbols.error).toBeDefined();
    expect(Symbols.warning).toBeDefined();
    expect(Symbols.info).toBeDefined();
  });
});

describe('getOperationSymbol()', () => {
  it('returns correct symbol for create', () => {
    const symbol = getOperationSymbol('create');
    expect(symbol).toContain('+');
  });

  it('returns correct symbol for update', () => {
    const symbol = getOperationSymbol('update');
    expect(symbol).toContain('~');
  });

  it('returns correct symbol for delete', () => {
    const symbol = getOperationSymbol('delete');
    expect(symbol).toContain('-');
  });

  it('returns correct symbol for noop', () => {
    const symbol = getOperationSymbol('noop');
    expect(symbol).toBeDefined();
  });
});

describe('colorByOperation()', () => {
  it('applies color to text', () => {
    const text = 'test';
    const colored = colorByOperation('create', text);

    // Should contain the text (color codes may wrap it)
    expect(colored).toContain('test');
  });

  it('handles all operations', () => {
    const operations = ['create', 'update', 'delete', 'noop'] as const;

    for (const op of operations) {
      const colored = colorByOperation(op, 'text');
      expect(colored).toContain('text');
    }
  });
});

describe('formatResourceChange()', () => {
  it('formats create change', () => {
    const change: ResourceChange<unknown> = {
      operation: 'create',
      name: 'Admin [managed-by:arrakis-iac]',
      after: { name: 'Admin [managed-by:arrakis-iac]' },
    };

    const output = formatResourceChange(change, 'role');

    expect(output).toContain('+');
    expect(output).toContain('role');
    expect(output).toContain('Admin');
  });

  it('formats update change with field changes', () => {
    const change: ResourceChange<unknown> = {
      operation: 'update',
      name: 'general',
      before: { topic: 'Old topic' },
      after: { topic: 'New topic' },
      changes: [{ field: 'topic', from: 'Old topic', to: 'New topic' }],
    };

    const output = formatResourceChange(change, 'channel');

    expect(output).toContain('~');
    expect(output).toContain('channel');
    expect(output).toContain('general');
    expect(output).toContain('topic');
    expect(output).toContain('Old topic');
    expect(output).toContain('New topic');
  });

  it('formats delete change', () => {
    const change: ResourceChange<unknown> = {
      operation: 'delete',
      name: 'old-channel',
      before: { name: 'old-channel' },
    };

    const output = formatResourceChange(change, 'channel');

    expect(output).toContain('-');
    expect(output).toContain('channel');
    expect(output).toContain('old-channel');
  });
});

describe('formatPermissionChange()', () => {
  it('formats permission change', () => {
    const change: PermissionChange = {
      operation: 'create',
      targetName: 'general',
      targetType: 'channel',
      subjectName: 'Admin',
      subjectType: 'role',
      after: {
        allow: ['VIEW_CHANNEL'],
        deny: [],
      },
    };

    const output = formatPermissionChange(change);

    expect(output).toContain('+');
    expect(output).toContain('permission');
    expect(output).toContain('general');
    expect(output).toContain('Admin');
  });
});

describe('formatPlan()', () => {
  it('formats empty diff', () => {
    const diff: ServerDiff = {
      roles: [],
      categories: [],
      channels: [],
      permissions: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, noop: 0 },
    };

    const output = formatPlan(diff);

    expect(output).toContain('No changes');
  });

  it('formats diff with changes', () => {
    const diff: ServerDiff = {
      roles: [
        {
          operation: 'create',
          name: 'Admin',
          after: { name: 'Admin' },
        },
      ],
      categories: [],
      channels: [
        {
          operation: 'update',
          name: 'general',
          before: { topic: 'Old' },
          after: { topic: 'New' },
          changes: [{ field: 'topic', from: 'Old', to: 'New' }],
        },
      ],
      permissions: [],
      hasChanges: true,
      summary: { create: 1, update: 1, delete: 0, noop: 0 },
    };

    const output = formatPlan(diff);

    expect(output).toContain('1 to create');
    expect(output).toContain('1 to update');
    expect(output).toContain('0 to delete');
    expect(output).toContain('Roles:');
    expect(output).toContain('Admin');
    expect(output).toContain('Channels:');
    expect(output).toContain('general');
  });
});

describe('formatPlanSummary()', () => {
  it('formats summary counts', () => {
    const diff: ServerDiff = {
      roles: [],
      categories: [],
      channels: [],
      permissions: [],
      hasChanges: true,
      summary: { create: 5, update: 3, delete: 1, noop: 10 },
    };

    const output = formatPlanSummary(diff);

    expect(output).toContain('5 to create');
    expect(output).toContain('3 to update');
    expect(output).toContain('1 to delete');
  });
});

describe('formatApplyResult()', () => {
  it('formats successful apply', () => {
    const result: ApplyBatchResult = {
      success: true,
      results: [
        { resourceType: 'role', resourceName: 'Admin', operation: 'create', success: true },
        { resourceType: 'channel', resourceName: 'general', operation: 'update', success: true },
      ],
      totalDurationMs: 1234,
    };

    const output = formatApplyResult(result);

    expect(output).toContain('Apply Complete');
    expect(output).toContain('1 created');
    expect(output).toContain('1 updated');
    expect(output).toContain('0 deleted');
    expect(output).toContain('1.23s');
  });

  it('formats failed apply with errors', () => {
    const result: ApplyBatchResult = {
      success: false,
      results: [
        { resourceType: 'role', resourceName: 'Admin', operation: 'create', success: true },
        { resourceType: 'channel', resourceName: 'general', operation: 'update', success: false, error: 'Missing permissions' },
      ],
      totalDurationMs: 500,
    };

    const output = formatApplyResult(result);

    expect(output).toContain('Apply Failed');
    expect(output).toContain('Errors');
    expect(output).toContain('Missing permissions');
  });
});

describe('formatDestroyResult()', () => {
  it('formats successful destroy', () => {
    const result = {
      success: true,
      destroyed: 5,
      errors: [],
      duration: 2000,
    };

    const output = formatDestroyResult(result);

    expect(output).toContain('Destroy Complete');
    expect(output).toContain('5 resources destroyed');
    expect(output).toContain('2.00s');
  });

  it('formats destroy with errors', () => {
    const result = {
      success: false,
      destroyed: 3,
      errors: [
        { address: 'role.Admin', error: 'Cannot delete' },
      ],
      duration: 1500,
    };

    const output = formatDestroyResult(result);

    expect(output).toContain('Destroy Failed');
    expect(output).toContain('3 resources destroyed');
    expect(output).toContain('Errors');
    expect(output).toContain('role.Admin');
    expect(output).toContain('Cannot delete');
  });
});

describe('formatStateList()', () => {
  it('formats empty state', () => {
    const output = formatStateList(null, 'default');

    expect(output).toContain('default');
    expect(output).toContain('No resources');
  });

  it('formats state with resources', () => {
    const state: GaibState = {
      version: 4,
      serial: 5,
      lineage: 'test-lineage',
      resources: [
        {
          mode: 'managed',
          type: 'role',
          name: 'Admin',
          provider: 'discord',
          instances: [
            {
              attributes: {
                id: '123456789',
                name: 'Admin [managed-by:arrakis-iac]',
              },
            },
          ],
        },
        {
          mode: 'managed',
          type: 'channel',
          name: 'general',
          provider: 'discord',
          instances: [
            {
              attributes: {
                id: '987654321',
                name: 'general',
              },
            },
          ],
        },
      ],
      outputs: {},
    };

    const output = formatStateList(state, 'default');

    expect(output).toContain('default');
    expect(output).toContain('5'); // serial
    expect(output).toContain('Admin');
    expect(output).toContain('general');
    expect(output).toContain('123456789');
    expect(output).toContain('987654321');
    expect(output).toContain('2 resource(s)');
  });
});

describe('Spinner', () => {
  it('creates spinner with message', () => {
    const spinner = createSpinner('Loading...');
    expect(spinner).toBeInstanceOf(Spinner);
  });

  it('can start and stop', () => {
    const spinner = new Spinner('Loading...');
    spinner.start();
    spinner.stop();
    // No errors means success
  });

  it('can update message', () => {
    const spinner = new Spinner('Loading...');
    spinner.update('Processing...');
    spinner.stop();
    // No errors means success
  });

  it('can stop with success', () => {
    const spinner = new Spinner('Loading...');
    spinner.start();
    spinner.succeed('Done!');
    // No errors means success
  });

  it('can stop with failure', () => {
    const spinner = new Spinner('Loading...');
    spinner.start();
    spinner.fail('Error!');
    // No errors means success
  });

  it('can stop with warning', () => {
    const spinner = new Spinner('Loading...');
    spinner.start();
    spinner.warn('Warning!');
    // No errors means success
  });
});

describe('formatTimestamp()', () => {
  it('formats ISO timestamp', () => {
    const timestamp = '2025-01-15T10:30:00Z';
    const formatted = formatTimestamp(timestamp);

    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe('formatDuration()', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1500)).toBe('1.5s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
  });
});

describe('formatBytes()', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1572864)).toBe('1.5 MB');
  });
});

describe('truncate()', () => {
  it('returns short string unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long string with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles edge case at exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});

describe('center()', () => {
  it('centers string in width', () => {
    const centered = center('hi', 6);
    expect(centered).toBe('  hi  ');
  });

  it('handles string longer than width', () => {
    const centered = center('hello', 3);
    expect(centered).toBe('hello');
  });

  it('handles odd padding', () => {
    const centered = center('hi', 5);
    expect(centered.length).toBe(5);
    expect(centered).toContain('hi');
  });
});

describe('box()', () => {
  it('draws box around content', () => {
    const content = 'Hello\nWorld';
    const output = box(content);

    expect(output).toContain('┌');
    expect(output).toContain('┐');
    expect(output).toContain('│');
    expect(output).toContain('└');
    expect(output).toContain('┘');
    expect(output).toContain('Hello');
    expect(output).toContain('World');
  });

  it('supports title', () => {
    const output = box('Content', 'Title');

    expect(output).toContain('Title');
    expect(output).toContain('Content');
  });
});

describe('formatJson()', () => {
  it('formats object as JSON', () => {
    const data = { key: 'value', number: 42 };
    const output = formatJson(data);

    expect(output).toContain('"key"');
    expect(output).toContain('"value"');
    expect(output).toContain('42');
  });

  it('formats with indentation', () => {
    const data = { nested: { key: 'value' } };
    const output = formatJson(data);

    expect(output).toContain('\n');
    expect(output).toContain('  ');
  });
});

describe('jsonSuccess()', () => {
  it('creates success response', () => {
    const output = jsonSuccess({ data: 'test' });
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe('test');
  });
});

describe('jsonError()', () => {
  it('creates error response', () => {
    const output = jsonError('Something went wrong', 'E1001');
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.error.message).toBe('Something went wrong');
    expect(parsed.error.code).toBe('E1001');
  });

  it('includes details when provided', () => {
    const output = jsonError('Error', 'E1001', { extra: 'info' });
    const parsed = JSON.parse(output);

    expect(parsed.error.details).toEqual({ extra: 'info' });
  });
});
