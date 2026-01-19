/**
 * Login Page Tests
 *
 * Sprint 116: Dashboard Shell
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './Login';

// Mock useAuth hook
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    error: null,
  }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render welcome message', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByText('Welcome to Stilgar')).toBeInTheDocument();
  });

  it('should render Discord sign in button', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByRole('button', { name: /sign in with discord/i })).toBeInTheDocument();
  });

  it('should display admin permission note', () => {
    renderWithProviders(<LoginPage />);
    expect(
      screen.getByText(/you need administrator permissions in a server to configure it/i)
    ).toBeInTheDocument();
  });
});
