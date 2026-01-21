/**
 * Authentication Hook
 *
 * SECURITY: CRIT-3 Frontend Authentication Remediation
 * Manages authentication state and API key verification.
 *
 * @see grimoires/loa/a2a/audits/2026-01-21/SECURITY-AUDIT-REPORT.md
 */

import { useState, useEffect, useCallback } from 'react';

// Storage key for API key
const API_KEY_STORAGE_KEY = 'sietch_api_key';

// Auth verification endpoint
const AUTH_VERIFY_ENDPOINT = '/api/auth/verify';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface UseAuthReturn extends AuthState {
  login: (apiKey: string) => Promise<boolean>;
  logout: () => void;
  getApiKey: () => string | null;
}

/**
 * Verify API key with backend
 */
async function verifyApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(AUTH_VERIFY_ENDPOINT, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get stored API key
 */
function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Store API key
 */
function storeApiKey(apiKey: string): void {
  try {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  } catch {
    // localStorage might be disabled
  }
}

/**
 * Clear stored API key
 */
function clearStoredApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    // localStorage might be disabled
  }
}

/**
 * useAuth Hook - Manages frontend authentication
 *
 * SECURITY: Part of CRIT-3 remediation
 * - Verifies API key on mount
 * - Clears credentials on auth failure
 * - Provides login/logout functions
 */
export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  // Verify stored credentials on mount
  useEffect(() => {
    const verifyStoredCredentials = async () => {
      const storedKey = getStoredApiKey();

      if (!storedKey) {
        setState({
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
        return;
      }

      const isValid = await verifyApiKey(storedKey);

      if (isValid) {
        setState({
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } else {
        // Clear invalid credentials
        clearStoredApiKey();
        setState({
          isAuthenticated: false,
          isLoading: false,
          error: 'Session expired. Please login again.',
        });
      }
    };

    verifyStoredCredentials();
  }, []);

  // Login function
  const login = useCallback(async (apiKey: string): Promise<boolean> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    if (!apiKey || apiKey.trim() === '') {
      setState({
        isAuthenticated: false,
        isLoading: false,
        error: 'API key is required',
      });
      return false;
    }

    const isValid = await verifyApiKey(apiKey.trim());

    if (isValid) {
      storeApiKey(apiKey.trim());
      setState({
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return true;
    } else {
      clearStoredApiKey();
      setState({
        isAuthenticated: false,
        isLoading: false,
        error: 'Invalid API key',
      });
      return false;
    }
  }, []);

  // Logout function
  const logout = useCallback(() => {
    clearStoredApiKey();
    setState({
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  }, []);

  // Get current API key
  const getApiKey = useCallback((): string | null => {
    return getStoredApiKey();
  }, []);

  return {
    ...state,
    login,
    logout,
    getApiKey,
  };
}

/**
 * Clear auth on 401/403 response
 * Call this from API client error handlers
 */
export function handleAuthError(status: number): void {
  if (status === 401 || status === 403) {
    clearStoredApiKey();
    // Force page reload to trigger auth flow
    window.location.reload();
  }
}
