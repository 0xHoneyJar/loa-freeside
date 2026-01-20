/**
 * Auth Store
 *
 * Sprint 116: Dashboard Shell
 * Sprint 144: Dashboard Login Integration
 *
 * Zustand store for authentication state management.
 * Supports both Discord OAuth and local username/password authentication.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
}

/**
 * Auth type discriminator
 */
export type AuthType = 'discord' | 'local';

/**
 * User roles for local authentication
 */
export type UserRole = 'admin' | 'qa_admin' | 'qa_tester';

/**
 * Base user properties
 */
interface BaseUser {
  id: string;
  username: string;
}

/**
 * Discord-authenticated user
 */
export interface DiscordUser extends BaseUser {
  authType: 'discord';
  avatar: string | null;
  adminGuilds: Guild[];
}

/**
 * Local-authenticated user (QA/Admin)
 */
export interface LocalUser extends BaseUser {
  authType: 'local';
  displayName: string | null;
  roles: UserRole[];
  sandboxAccess: string[];
  requirePasswordChange?: boolean;
}

/**
 * Union type for all user types
 */
export type User = DiscordUser | LocalUser;

/**
 * Type guard for Discord users
 */
export function isDiscordUser(user: User | null): user is DiscordUser {
  return user?.authType === 'discord';
}

/**
 * Type guard for Local users
 */
export function isLocalUser(user: User | null): user is LocalUser {
  return user?.authType === 'local';
}

interface AuthState {
  user: User | null;
  selectedGuildId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setUser: (user: User | null) => void;
  selectGuild: (guildId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      selectedGuildId: null,
      isLoading: false,
      error: null,

      setUser: (user) => set({ user, error: null }),

      selectGuild: (guildId) => set({ selectedGuildId: guildId }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      logout: () =>
        set({
          user: null,
          selectedGuildId: null,
          error: null,
        }),
    }),
    {
      name: 'stilgar-auth',
      partialize: (state) => ({
        selectedGuildId: state.selectedGuildId,
      }),
    }
  )
);
