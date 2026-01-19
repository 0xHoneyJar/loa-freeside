/**
 * Auth API Client
 *
 * Sprint 116: Dashboard Shell
 *
 * API functions for authentication endpoints.
 */

import type { User } from '@/stores/authStore';

const API_BASE = '/api/dashboard/auth';

export interface AuthError {
  error: string;
  message: string;
}

/**
 * Fetch current user info
 */
export async function fetchMe(): Promise<User> {
  const response = await fetch(`${API_BASE}/me`, {
    credentials: 'include',
  });

  if (!response.ok) {
    const error = (await response.json()) as AuthError;
    throw new Error(error.message);
  }

  return response.json();
}

/**
 * Logout current user
 */
export async function logout(): Promise<void> {
  const response = await fetch(`${API_BASE}/logout`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = (await response.json()) as AuthError;
    throw new Error(error.message);
  }
}

/**
 * Refresh session token
 */
export async function refreshSession(): Promise<{ refreshed: boolean }> {
  const response = await fetch(`${API_BASE}/refresh`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    const error = (await response.json()) as AuthError;
    throw new Error(error.message);
  }

  return response.json();
}

/**
 * Get Discord OAuth URL
 */
export function getDiscordAuthUrl(): string {
  return `${API_BASE}/discord`;
}
