import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Theme, PageLayout, ComponentInstance, ThemeBranding } from '@types';

interface ThemeState {
  // Current theme being edited
  theme: Theme | null;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Dirty tracking
  isDirty: boolean;
  lastSavedAt: string | null;
}

interface ThemeActions {
  // Theme CRUD
  setTheme: (theme: Theme | null) => void;
  updateTheme: (updates: Partial<Theme>) => void;

  // Branding updates
  updateBranding: (updates: Partial<ThemeBranding>) => void;
  updateColors: (colors: Partial<ThemeBranding['colors']>) => void;
  updateFonts: (fonts: Partial<ThemeBranding['fonts']>) => void;

  // Page management
  addPage: (page: PageLayout) => void;
  updatePage: (pageId: string, updates: Partial<PageLayout>) => void;
  deletePage: (pageId: string) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;

  // Component management
  addComponent: (pageId: string, component: ComponentInstance, index?: number) => void;
  updateComponent: (pageId: string, componentId: string, updates: Partial<ComponentInstance>) => void;
  deleteComponent: (pageId: string, componentId: string) => void;
  reorderComponents: (pageId: string, fromIndex: number, toIndex: number) => void;
  moveComponentToPage: (fromPageId: string, toPageId: string, componentId: string, toIndex?: number) => void;

  // Component nesting (for layout containers)
  addChildComponent: (pageId: string, parentId: string, component: ComponentInstance, index?: number) => void;

  // Loading states
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;

  // Dirty tracking
  markClean: () => void;

  // Reset
  reset: () => void;
}

const initialState: ThemeState = {
  theme: null,
  isLoading: false,
  error: null,
  isDirty: false,
  lastSavedAt: null,
};

// Helper to find component in nested structure
function findComponentById(
  components: ComponentInstance[],
  id: string
): { component: ComponentInstance; parent: ComponentInstance[] } | null {
  for (const comp of components) {
    if (comp.id === id) {
      return { component: comp, parent: components };
    }
    if (comp.children) {
      const found = findComponentById(comp.children, id);
      if (found) return found;
    }
  }
  return null;
}

export const useThemeStore = create<ThemeState & ThemeActions>()(
  devtools(
    immer((set) => ({
      ...initialState,

      setTheme: (theme) => set((state) => {
        state.theme = theme;
        state.isDirty = false;
        state.error = null;
      }),

      updateTheme: (updates) => set((state) => {
        if (!state.theme) return;
        Object.assign(state.theme, updates);
        state.theme.updatedAt = new Date().toISOString();
        state.isDirty = true;
      }),

      updateBranding: (updates) => set((state) => {
        if (!state.theme) return;
        Object.assign(state.theme.branding, updates);
        state.theme.updatedAt = new Date().toISOString();
        state.isDirty = true;
      }),

      updateColors: (colors) => set((state) => {
        if (!state.theme) return;
        Object.assign(state.theme.branding.colors, colors);
        state.theme.updatedAt = new Date().toISOString();
        state.isDirty = true;
      }),

      updateFonts: (fonts) => set((state) => {
        if (!state.theme) return;
        if (fonts.heading) {
          Object.assign(state.theme.branding.fonts.heading, fonts.heading);
        }
        if (fonts.body) {
          Object.assign(state.theme.branding.fonts.body, fonts.body);
        }
        state.theme.updatedAt = new Date().toISOString();
        state.isDirty = true;
      }),

      addPage: (page) => set((state) => {
        if (!state.theme) return;
        state.theme.pages.push(page);
        state.theme.updatedAt = new Date().toISOString();
        state.isDirty = true;
      }),

      updatePage: (pageId, updates) => set((state) => {
        if (!state.theme) return;
        const page = state.theme.pages.find(p => p.id === pageId);
        if (page) {
          Object.assign(page, updates);
          state.theme.updatedAt = new Date().toISOString();
          state.isDirty = true;
        }
      }),

      deletePage: (pageId) => set((state) => {
        if (!state.theme) return;
        const index = state.theme.pages.findIndex(p => p.id === pageId);
        if (index !== -1) {
          state.theme.pages.splice(index, 1);
          state.theme.updatedAt = new Date().toISOString();
          state.isDirty = true;
        }
      }),

      reorderPages: (fromIndex, toIndex) => set((state) => {
        if (!state.theme) return;
        const [page] = state.theme.pages.splice(fromIndex, 1);
        state.theme.pages.splice(toIndex, 0, page);
        state.theme.updatedAt = new Date().toISOString();
        state.isDirty = true;
      }),

      addComponent: (pageId, component, index) => set((state) => {
        if (!state.theme) return;
        const page = state.theme.pages.find(p => p.id === pageId);
        if (page) {
          if (index !== undefined) {
            page.components.splice(index, 0, component);
          } else {
            page.components.push(component);
          }
          state.theme.updatedAt = new Date().toISOString();
          state.isDirty = true;
        }
      }),

      updateComponent: (pageId, componentId, updates) => set((state) => {
        if (!state.theme) return;
        const page = state.theme.pages.find(p => p.id === pageId);
        if (page) {
          const found = findComponentById(page.components, componentId);
          if (found) {
            Object.assign(found.component, updates);
            state.theme.updatedAt = new Date().toISOString();
            state.isDirty = true;
          }
        }
      }),

      deleteComponent: (pageId, componentId) => set((state) => {
        if (!state.theme) return;
        const page = state.theme.pages.find(p => p.id === pageId);
        if (page) {
          const found = findComponentById(page.components, componentId);
          if (found) {
            const index = found.parent.findIndex(c => c.id === componentId);
            if (index !== -1) {
              found.parent.splice(index, 1);
              state.theme.updatedAt = new Date().toISOString();
              state.isDirty = true;
            }
          }
        }
      }),

      reorderComponents: (pageId, fromIndex, toIndex) => set((state) => {
        if (!state.theme) return;
        const page = state.theme.pages.find(p => p.id === pageId);
        if (page) {
          const [component] = page.components.splice(fromIndex, 1);
          page.components.splice(toIndex, 0, component);
          state.theme.updatedAt = new Date().toISOString();
          state.isDirty = true;
        }
      }),

      moveComponentToPage: (fromPageId, toPageId, componentId, toIndex) => set((state) => {
        if (!state.theme) return;
        const fromPage = state.theme.pages.find(p => p.id === fromPageId);
        const toPage = state.theme.pages.find(p => p.id === toPageId);
        if (fromPage && toPage) {
          const index = fromPage.components.findIndex(c => c.id === componentId);
          if (index !== -1) {
            const [component] = fromPage.components.splice(index, 1);
            if (toIndex !== undefined) {
              toPage.components.splice(toIndex, 0, component);
            } else {
              toPage.components.push(component);
            }
            state.theme.updatedAt = new Date().toISOString();
            state.isDirty = true;
          }
        }
      }),

      addChildComponent: (pageId, parentId, component, index) => set((state) => {
        if (!state.theme) return;
        const page = state.theme.pages.find(p => p.id === pageId);
        if (page) {
          const found = findComponentById(page.components, parentId);
          if (found) {
            if (!found.component.children) {
              found.component.children = [];
            }
            if (index !== undefined) {
              found.component.children.splice(index, 0, component);
            } else {
              found.component.children.push(component);
            }
            state.theme.updatedAt = new Date().toISOString();
            state.isDirty = true;
          }
        }
      }),

      setLoading: (isLoading) => set((state) => {
        state.isLoading = isLoading;
      }),

      setError: (error) => set((state) => {
        state.error = error;
        state.isLoading = false;
      }),

      markClean: () => set((state) => {
        state.isDirty = false;
        state.lastSavedAt = new Date().toISOString();
      }),

      reset: () => set(initialState),
    })),
    { name: 'ThemeStore' }
  )
);

// Selectors
export const selectCurrentPage = (state: ThemeState) => {
  if (!state.theme) return null;
  // This would need the activePageId from editorStore
  return state.theme.pages[0] || null;
};

export const selectPageById = (state: ThemeState, pageId: string) => {
  return state.theme?.pages.find(p => p.id === pageId) || null;
};

export const selectComponentById = (state: ThemeState, pageId: string, componentId: string) => {
  const page = state.theme?.pages.find(p => p.id === pageId);
  if (!page) return null;
  return findComponentById(page.components, componentId)?.component || null;
};
