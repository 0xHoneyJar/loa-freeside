/**
 * Auth API Client
 *
 * Sprint 116: Dashboard Shell
 * Sprint 144: Dashboard Login Integration
 * Sprint 145: Change Password Support
 *
 * API functions for authentication endpoints.
 * Supports both Discord OAuth and local username/password auth.
 */

import type { User } from '@/stores/authStore';

const API_BASE = '/api/dashboard/auth';

export interface AuthError {
  error: string;
  message: string;
  code?: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  user?: User;
  requirePasswordChange?: boolean;
  error?: string;
  code?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  success: boolean;
  message?: string;
  error?: string;
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

/**
 * Login with username and password
 */
export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(credentials),
  });

  const data = await response.json() as LoginResponse;

  if (!response.ok) {
    throw new Error(data.error || 'Login failed');
  }

  return data;
}

/**
 * Change password for local users (Sprint 145)
 */
export async function changePassword(request: ChangePasswordRequest): Promise<ChangePasswordResponse> {
  const response = await fetch(`${API_BASE}/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(request),
  });

  const data = await response.json() as ChangePasswordResponse;

  if (!response.ok) {
    throw new Error(data.error || 'Password change failed');
  }

  return data;
}
