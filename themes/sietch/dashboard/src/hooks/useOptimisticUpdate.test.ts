/**
 * useOptimisticUpdate Hook Tests
 *
 * Sprint 128: Threshold Editor
 *
 * Tests for optimistic update and draft mode hooks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOptimisticUpdate, useDraftMode } from './useOptimisticUpdate';

// =============================================================================
// useOptimisticUpdate Tests
// =============================================================================

describe('useOptimisticUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with the provided value', () => {
    const { result } = renderHook(() =>
      useOptimisticUpdate({
        initialValue: { count: 0 },
        onUpdate: vi.fn().mockResolvedValue({ count: 0 }),
      })
    );

    expect(result.current.state.value).toEqual({ count: 0 });
    expect(result.current.state.isPending).toBe(false);
    expect(result.current.state.isOptimistic).toBe(false);
    expect(result.current.state.error).toBeNull();
  });

  it('should apply optimistic update immediately', async () => {
    const onUpdate = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ count: 5 }), 100))
    );

    const { result } = renderHook(() =>
      useOptimisticUpdate({
        initialValue: { count: 0 },
        onUpdate,
      })
    );

    act(() => {
      result.current.update({ count: 5 });
    });

    // Value should be updated immediately (optimistic)
    expect(result.current.state.value).toEqual({ count: 5 });
    expect(result.current.state.isOptimistic).toBe(true);
  });

  it('should call onUpdate and confirm value on success', async () => {
    const onUpdate = vi.fn().mockResolvedValue({ count: 10 });
    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticUpdate({
        initialValue: { count: 0 },
        onUpdate,
        onSuccess,
      })
    );

    await act(async () => {
      await result.current.update({ count: 10 });
    });

    expect(onUpdate).toHaveBeenCalledWith({ count: 10 });
    expect(onSuccess).toHaveBeenCalledWith({ count: 10 });
    expect(result.current.state.value).toEqual({ count: 10 });
    expect(result.current.state.isOptimistic).toBe(false);
  });

  it('should rollback on error', async () => {
    const error = new Error('Update failed');
    const onUpdate = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useOptimisticUpdate({
        initialValue: { count: 0 },
        onUpdate,
        onError,
      })
    );

    await act(async () => {
      await result.current.update({ count: 10 });
    });

    // Should rollback to initial value
    expect(result.current.state.value).toEqual({ count: 0 });
    expect(result.current.state.error).toBe(error);
    expect(result.current.state.isOptimistic).toBe(false);
    expect(onError).toHaveBeenCalledWith(error, { count: 0 });
  });

  it('should reset to initial value', async () => {
    const onUpdate = vi.fn().mockResolvedValue({ count: 10 });

    const { result } = renderHook(() =>
      useOptimisticUpdate({
        initialValue: { count: 0 },
        onUpdate,
      })
    );

    await act(async () => {
      await result.current.update({ count: 10 });
    });

    expect(result.current.state.value).toEqual({ count: 10 });

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.value).toEqual({ count: 0 });
  });

  it('should allow setting value directly', () => {
    const { result } = renderHook(() =>
      useOptimisticUpdate({
        initialValue: { count: 0 },
        onUpdate: vi.fn(),
      })
    );

    act(() => {
      result.current.setValue({ count: 99 });
    });

    expect(result.current.state.value).toEqual({ count: 99 });
    expect(result.current.state.isOptimistic).toBe(false);
  });
});

// =============================================================================
// useDraftMode Tests
// =============================================================================

describe('useDraftMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with the provided value', () => {
    const { result } = renderHook(() =>
      useDraftMode({
        value: { name: 'test' },
        onPublish: vi.fn(),
      })
    );

    expect(result.current.state.draft).toEqual({ name: 'test' });
    expect(result.current.state.original).toEqual({ name: 'test' });
    expect(result.current.state.isDirty).toBe(false);
    expect(result.current.state.isPublishing).toBe(false);
  });

  it('should track dirty state when draft changes', () => {
    const { result } = renderHook(() =>
      useDraftMode({
        value: { name: 'test' },
        onPublish: vi.fn(),
      })
    );

    act(() => {
      result.current.updateDraft({ name: 'changed' });
    });

    expect(result.current.state.draft).toEqual({ name: 'changed' });
    expect(result.current.state.isDirty).toBe(true);
  });

  it('should not be dirty when draft matches original', () => {
    const { result } = renderHook(() =>
      useDraftMode({
        value: { name: 'test' },
        onPublish: vi.fn(),
      })
    );

    act(() => {
      result.current.updateDraft({ name: 'changed' });
    });

    expect(result.current.state.isDirty).toBe(true);

    act(() => {
      result.current.updateDraft({ name: 'test' });
    });

    expect(result.current.state.isDirty).toBe(false);
  });

  it('should publish draft and call callbacks', async () => {
    const onPublish = vi.fn().mockResolvedValue({ name: 'published' });
    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useDraftMode({
        value: { name: 'test' },
        onPublish,
        onSuccess,
      })
    );

    act(() => {
      result.current.updateDraft({ name: 'changed' });
    });

    await act(async () => {
      await result.current.publish();
    });

    expect(onPublish).toHaveBeenCalledWith({ name: 'changed' });
    expect(onSuccess).toHaveBeenCalledWith({ name: 'published' });
  });

  it('should handle publish error', async () => {
    const error = new Error('Publish failed');
    const onPublish = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useDraftMode({
        value: { name: 'test' },
        onPublish,
        onError,
      })
    );

    act(() => {
      result.current.updateDraft({ name: 'changed' });
    });

    await act(async () => {
      await result.current.publish();
    });

    expect(result.current.state.error).toBe(error);
    expect(onError).toHaveBeenCalledWith(error);
    // Draft should still have changes
    expect(result.current.state.draft).toEqual({ name: 'changed' });
  });

  it('should discard changes', () => {
    const { result } = renderHook(() =>
      useDraftMode({
        value: { name: 'test' },
        onPublish: vi.fn(),
      })
    );

    act(() => {
      result.current.updateDraft({ name: 'changed' });
    });

    expect(result.current.state.isDirty).toBe(true);

    act(() => {
      result.current.discard();
    });

    expect(result.current.state.draft).toEqual({ name: 'test' });
    expect(result.current.state.isDirty).toBe(false);
  });

  it('should not publish when not dirty', async () => {
    const onPublish = vi.fn();

    const { result } = renderHook(() =>
      useDraftMode({
        value: { name: 'test' },
        onPublish,
      })
    );

    await act(async () => {
      await result.current.publish();
    });

    expect(onPublish).not.toHaveBeenCalled();
  });

  it('should use custom isEqual function', () => {
    const { result } = renderHook(() =>
      useDraftMode({
        value: { name: 'test', timestamp: 1 },
        onPublish: vi.fn(),
        // Ignore timestamp field in comparison
        isEqual: (a, b) => a.name === b.name,
      })
    );

    act(() => {
      result.current.updateDraft({ name: 'test', timestamp: 999 });
    });

    // Should not be dirty because name is the same
    expect(result.current.state.isDirty).toBe(false);

    act(() => {
      result.current.updateDraft({ name: 'changed', timestamp: 999 });
    });

    // Should be dirty because name changed
    expect(result.current.state.isDirty).toBe(true);
  });
});
