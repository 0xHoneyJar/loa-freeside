/**
 * Auth Store Tests
 *
 * Sprint 116: Dashboard Shell
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      user: null,
      selectedGuildId: null,
      isLoading: false,
      error: null,
    });
  });

  it('should have initial state', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.selectedGuildId).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should set user', () => {
    const testUser = {
      id: 'user-123',
      username: 'TestUser',
      avatar: null,
      adminGuilds: [{ id: 'guild-1', name: 'Test Guild', icon: null }],
    };

    useAuthStore.getState().setUser(testUser);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(testUser);
    expect(state.error).toBeNull();
  });

  it('should select guild', () => {
    useAuthStore.getState().selectGuild('guild-123');

    const state = useAuthStore.getState();
    expect(state.selectedGuildId).toBe('guild-123');
  });

  it('should set loading state', () => {
    useAuthStore.getState().setLoading(true);

    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(true);
  });

  it('should set error', () => {
    useAuthStore.getState().setError('Test error');

    const state = useAuthStore.getState();
    expect(state.error).toBe('Test error');
  });

  it('should logout and clear state', () => {
    // Set up some state
    useAuthStore.getState().setUser({
      id: 'user-123',
      username: 'TestUser',
      avatar: null,
      adminGuilds: [],
    });
    useAuthStore.getState().selectGuild('guild-123');
    useAuthStore.getState().setError('some error');

    // Logout
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.selectedGuildId).toBeNull();
    expect(state.error).toBeNull();
  });
});
