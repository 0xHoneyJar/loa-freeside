import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ComponentDefinition } from '@types';

interface ComponentState {
  // Available component definitions from registry
  definitions: ComponentDefinition[];

  // Loading state
  isLoading: boolean;
  error: string | null;

  // Filter/search state
  searchQuery: string;
  activeCategory: string | null;
}

interface ComponentActions {
  // Load definitions from API
  setDefinitions: (definitions: ComponentDefinition[]) => void;

  // Search/filter
  setSearchQuery: (query: string) => void;
  setActiveCategory: (category: string | null) => void;

  // Loading states
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;

  // Reset
  reset: () => void;
}

const initialState: ComponentState = {
  definitions: [],
  isLoading: false,
  error: null,
  searchQuery: '',
  activeCategory: null,
};

export const useComponentStore = create<ComponentState & ComponentActions>()(
  devtools(
    (set) => ({
      ...initialState,

      setDefinitions: (definitions) => set({
        definitions,
        isLoading: false,
        error: null,
      }),

      setSearchQuery: (searchQuery) => set({ searchQuery }),

      setActiveCategory: (activeCategory) => set({ activeCategory }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({
        error,
        isLoading: false,
      }),

      reset: () => set(initialState),
    }),
    { name: 'ComponentStore' }
  )
);

// Selectors
export const selectFilteredComponents = (state: ComponentState): ComponentDefinition[] => {
  let filtered = state.definitions;

  // Filter by category
  if (state.activeCategory) {
    filtered = filtered.filter(c => c.category === state.activeCategory);
  }

  // Filter by search query
  if (state.searchQuery) {
    const query = state.searchQuery.toLowerCase();
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(query) ||
      c.description.toLowerCase().includes(query) ||
      c.type.toLowerCase().includes(query)
    );
  }

  return filtered;
};

export const selectCategories = (state: ComponentState): string[] => {
  const categories = new Set(state.definitions.map(c => c.category));
  return Array.from(categories).sort();
};

export const selectComponentByType = (state: ComponentState, type: string): ComponentDefinition | undefined => {
  return state.definitions.find(c => c.type === type);
};
