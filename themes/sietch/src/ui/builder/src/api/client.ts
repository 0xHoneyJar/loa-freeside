/**
 * API Client
 *
 * SECURITY: CRIT-3 Frontend Authentication Remediation
 * - Includes auth headers on all requests
 * - Handles 401/403 with credential clearing
 *
 * @see grimoires/loa/a2a/audits/2026-01-21/SECURITY-AUDIT-REPORT.md
 */

const API_BASE = '/api';
const API_KEY_STORAGE_KEY = 'sietch_api_key';

interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}

/**
 * Get stored API key for requests
 */
function getApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear stored API key on auth failure
 */
function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    // localStorage might be disabled
  }
}

/**
 * Handle authentication errors
 * SECURITY: Clears credentials and redirects to login
 */
function handleAuthError(status: number): void {
  if (status === 401 || status === 403) {
    clearApiKey();
    // Force page reload to trigger auth flow
    window.location.reload();
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  /**
   * Build headers with authentication
   * SECURITY: Always includes API key if available
   */
  private buildHeaders(additionalHeaders: HeadersInit = {}): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const apiKey = getApiKey();
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    return { ...headers, ...additionalHeaders };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: this.buildHeaders(options.headers as Record<string, string>),
    });

    // Handle auth errors
    if (response.status === 401 || response.status === 403) {
      handleAuthError(response.status);
      throw new Error('Authentication required');
    }

    if (!response.ok) {
      let errorData: ApiError;
      try {
        errorData = (await response.json()) as ApiError;
      } catch {
        errorData = { message: `HTTP error ${response.status}` };
      }
      throw new Error(errorData.message || `Request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async patch<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
