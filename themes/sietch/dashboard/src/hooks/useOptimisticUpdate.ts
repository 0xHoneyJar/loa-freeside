/**
 * Optimistic Update Hook
 *
 * Sprint 128: Threshold Editor
 *
 * Provides optimistic UI updates with automatic rollback on error.
 * Integrates with TanStack Query for cache management.
 *
 * @module hooks/useOptimisticUpdate
 */

import { useState, useCallback, useRef } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface OptimisticState<T> {
  /** Current value (optimistic or confirmed) */
  value: T;
  /** Whether an update is in progress */
  isPending: boolean;
  /** Error from last failed update */
  error: Error | null;
  /** Whether current value is optimistic (not yet confirmed) */
  isOptimistic: boolean;
}

export interface UseOptimisticUpdateOptions<T> {
  /** Initial value */
  initialValue: T;
  /** Function to perform the actual update */
  onUpdate: (newValue: T) => Promise<T>;
  /** Optional callback on successful update */
  onSuccess?: (confirmedValue: T) => void;
  /** Optional callback on failed update */
  onError?: (error: Error, rolledBackValue: T) => void;
  /** Delay before showing pending state (prevents flicker) */
  pendingDelay?: number;
}

export interface UseOptimisticUpdateResult<T> {
  /** Current state */
  state: OptimisticState<T>;
  /** Update the value optimistically */
  update: (newValue: T) => Promise<void>;
  /** Reset to initial value */
  reset: () => void;
  /** Set value directly (no API call) */
  setValue: (value: T) => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing optimistic updates with automatic rollback
 *
 * @example
 * ```tsx
 * const { state, update } = useOptimisticUpdate({
 *   initialValue: thresholds,
 *   onUpdate: async (newThresholds) => {
 *     const response = await api.updateThresholds(newThresholds);
 *     return response.data;
 *   },
 *   onError: (error) => {
 *     toast.error('Failed to save changes');
 *   }
 * });
 *
 * // Update optimistically
 * await update({ ...state.value, bgt: 100 });
 * ```
 */
export function useOptimisticUpdate<T>({
  initialValue,
  onUpdate,
  onSuccess,
  onError,
  pendingDelay = 200,
}: UseOptimisticUpdateOptions<T>): UseOptimisticUpdateResult<T> {
  const [state, setState] = useState<OptimisticState<T>>({
    value: initialValue,
    isPending: false,
    error: null,
    isOptimistic: false,
  });

  // Track the confirmed value for rollback
  const confirmedValueRef = useRef<T>(initialValue);
  const pendingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const update = useCallback(
    async (newValue: T) => {
      // Clear any pending timeout
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
      }

      // Apply optimistic update immediately
      setState((prev) => ({
        ...prev,
        value: newValue,
        isOptimistic: true,
        error: null,
      }));

      // Delay showing pending state to prevent flicker
      pendingTimeoutRef.current = setTimeout(() => {
        setState((prev) => ({
          ...prev,
          isPending: true,
        }));
      }, pendingDelay);

      try {
        // Perform the actual update
        const confirmedValue = await onUpdate(newValue);

        // Clear pending timeout
        if (pendingTimeoutRef.current) {
          clearTimeout(pendingTimeoutRef.current);
        }

        // Update confirmed value
        confirmedValueRef.current = confirmedValue;

        setState({
          value: confirmedValue,
          isPending: false,
          error: null,
          isOptimistic: false,
        });

        onSuccess?.(confirmedValue);
      } catch (err) {
        // Clear pending timeout
        if (pendingTimeoutRef.current) {
          clearTimeout(pendingTimeoutRef.current);
        }

        const error = err instanceof Error ? err : new Error(String(err));
        const rolledBackValue = confirmedValueRef.current;

        // Rollback to confirmed value
        setState({
          value: rolledBackValue,
          isPending: false,
          error,
          isOptimistic: false,
        });

        onError?.(error, rolledBackValue);
      }
    },
    [onUpdate, onSuccess, onError, pendingDelay]
  );

  const reset = useCallback(() => {
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
    }
    confirmedValueRef.current = initialValue;
    setState({
      value: initialValue,
      isPending: false,
      error: null,
      isOptimistic: false,
    });
  }, [initialValue]);

  const setValue = useCallback((value: T) => {
    confirmedValueRef.current = value;
    setState({
      value,
      isPending: false,
      error: null,
      isOptimistic: false,
    });
  }, []);

  return { state, update, reset, setValue };
}

// =============================================================================
// Draft Mode Hook
// =============================================================================

export interface DraftState<T> {
  /** Current draft value */
  draft: T;
  /** Original confirmed value */
  original: T;
  /** Whether draft has unsaved changes */
  isDirty: boolean;
  /** Whether publish is in progress */
  isPublishing: boolean;
  /** Error from last failed publish */
  error: Error | null;
}

export interface UseDraftModeOptions<T> {
  /** Original confirmed value */
  value: T;
  /** Function to publish the draft */
  onPublish: (draft: T) => Promise<T>;
  /** Optional callback on successful publish */
  onSuccess?: (published: T) => void;
  /** Optional callback on failed publish */
  onError?: (error: Error) => void;
  /** Function to compare values for dirty detection */
  isEqual?: (a: T, b: T) => boolean;
}

export interface UseDraftModeResult<T> {
  /** Current state */
  state: DraftState<T>;
  /** Update the draft */
  updateDraft: (draft: T) => void;
  /** Publish the draft */
  publish: () => Promise<void>;
  /** Discard draft changes */
  discard: () => void;
}

/**
 * Hook for managing draft mode with explicit publish
 *
 * @example
 * ```tsx
 * const { state, updateDraft, publish, discard } = useDraftMode({
 *   value: thresholds,
 *   onPublish: async (draft) => {
 *     const response = await api.updateThresholds(draft);
 *     return response.data;
 *   }
 * });
 *
 * // Update draft (no API call)
 * updateDraft({ ...state.draft, bgt: 100 });
 *
 * // Publish when ready
 * await publish();
 * ```
 */
export function useDraftMode<T>({
  value,
  onPublish,
  onSuccess,
  onError,
  isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b),
}: UseDraftModeOptions<T>): UseDraftModeResult<T> {
  const [draft, setDraft] = useState<T>(value);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const isDirty = !isEqual(draft, value);

  const updateDraft = useCallback((newDraft: T) => {
    setDraft(newDraft);
    setError(null);
  }, []);

  const publish = useCallback(async () => {
    if (!isDirty) return;

    setIsPublishing(true);
    setError(null);

    try {
      const published = await onPublish(draft);
      setDraft(published);
      onSuccess?.(published);
    } catch (err) {
      const publishError = err instanceof Error ? err : new Error(String(err));
      setError(publishError);
      onError?.(publishError);
    } finally {
      setIsPublishing(false);
    }
  }, [draft, isDirty, onPublish, onSuccess, onError]);

  const discard = useCallback(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  return {
    state: {
      draft,
      original: value,
      isDirty,
      isPublishing,
      error,
    },
    updateDraft,
    publish,
    discard,
  };
}

export default useOptimisticUpdate;
