/**
 * Auth Store
 *
 * Sprint 116: Dashboard Shell
 *
 * Zustand store for authentication state management.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
}

export interface User {
  id: string;
  username: string;
  avatar: string | null;
  adminGuilds: Guild[];
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
