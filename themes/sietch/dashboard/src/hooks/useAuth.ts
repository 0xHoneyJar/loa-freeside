/**
 * Auth Hook
 *
 * Sprint 116: Dashboard Shell
 * Sprint 144: Dashboard Login Integration
 *
 * TanStack Query hook for authentication state.
 * Supports both Discord OAuth and local username/password auth.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMe, logout as logoutApi, refreshSession, login as loginApi, type LoginCredentials } from '@/api/auth';
import { useAuthStore, isLocalUser } from '@/stores/authStore';
import { useEffect } from 'react';

export const AUTH_QUERY_KEY = ['auth', 'me'];

export function useAuth() {
  const queryClient = useQueryClient();
  const { setUser, logout: clearAuthStore, setLoading, setError } = useAuthStore();

  const query = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchMe,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Sync query state to zustand store
  useEffect(() => {
    setLoading(query.isLoading);
    if (query.data) {
      setUser(query.data);
    }
    if (query.error) {
      setError(query.error.message);
      setUser(null);
    }
  }, [query.data, query.error, query.isLoading, setUser, setLoading, setError]);

  const logoutMutation = useMutation({
    mutationFn: logoutApi,
    onSuccess: () => {
      clearAuthStore();
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
      queryClient.invalidateQueries();
    },
  });

  const refreshMutation = useMutation({
    mutationFn: refreshSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    },
  });

  const loginMutation = useMutation({
    mutationFn: (credentials: LoginCredentials) => loginApi(credentials),
    onSuccess: (data) => {
      if (data.user) {
        setUser(data.user);
        queryClient.setQueryData(AUTH_QUERY_KEY, data.user);
      }
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  // Check if user needs to change password (local auth only)
  const requirePasswordChange = query.data && isLocalUser(query.data) && query.data.requirePasswordChange;

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    isAuthenticated: !!query.data,
    error: query.error?.message ?? loginMutation.error?.message ?? null,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
    refresh: refreshMutation.mutate,
    refetch: query.refetch,
    // Local auth specific
    login: loginMutation.mutate,
    loginAsync: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error?.message ?? null,
    requirePasswordChange,
  };
}
