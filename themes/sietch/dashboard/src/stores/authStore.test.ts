/**
 * Auth Store Tests
 *
 * Sprint 116: Dashboard Shell
 * Sprint 144: Dashboard Login Integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore, isDiscordUser, isLocalUser, type DiscordUser, type LocalUser } from './authStore';

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

  it('should set Discord user', () => {
    const testUser: DiscordUser = {
      authType: 'discord',
      id: 'user-123',
      username: 'TestUser',
      avatar: null,
      adminGuilds: [{ id: 'guild-1', name: 'Test Guild', icon: null }],
    };

    useAuthStore.getState().setUser(testUser);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(testUser);
    expect(state.error).toBeNull();
    expect(isDiscordUser(state.user)).toBe(true);
    expect(isLocalUser(state.user)).toBe(false);
  });

  it('should set local user', () => {
    const testUser: LocalUser = {
      authType: 'local',
      id: 'user-456',
      username: 'qa_tester',
      displayName: 'QA Tester',
      roles: ['qa_tester'],
      sandboxAccess: ['sandbox-1'],
    };

    useAuthStore.getState().setUser(testUser);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(testUser);
    expect(state.error).toBeNull();
    expect(isLocalUser(state.user)).toBe(true);
    expect(isDiscordUser(state.user)).toBe(false);
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
      authType: 'discord',
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
