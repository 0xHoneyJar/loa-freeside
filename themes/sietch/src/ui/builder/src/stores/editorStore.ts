import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { ViewportSize, ComponentInstance } from '@types';

interface EditorState {
  // Selection state
  activeThemeId: string | null;
  selectedComponentId: string | null;
  activePageId: string | null;

  // UI state
  viewport: ViewportSize;
  isDragging: boolean;
  isPreviewMode: boolean;
  isSaving: boolean;

  // Clipboard
  copiedComponent: ComponentInstance | null;

  // History for undo/redo
  historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;
}

interface EditorActions {
  // Theme actions
  setActiveTheme: (themeId: string | null) => void;

  // Page actions
  setActivePage: (pageId: string | null) => void;

  // Component selection
  selectComponent: (componentId: string | null) => void;

  // Viewport
  setViewport: (viewport: ViewportSize) => void;

  // Drag state
  setDragging: (isDragging: boolean) => void;

  // Preview mode
  togglePreviewMode: () => void;
  setPreviewMode: (isPreview: boolean) => void;

  // Saving state
  setSaving: (isSaving: boolean) => void;

  // Clipboard
  copyComponent: (component: ComponentInstance) => void;
  clearClipboard: () => void;

  // Reset
  reset: () => void;
}

const initialState: EditorState = {
  activeThemeId: null,
  selectedComponentId: null,
  activePageId: null,
  viewport: 'desktop',
  isDragging: false,
  isPreviewMode: false,
  isSaving: false,
  copiedComponent: null,
  historyIndex: -1,
  canUndo: false,
  canRedo: false,
};

export const useEditorStore = create<EditorState & EditorActions>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        setActiveTheme: (themeId) => set({
          activeThemeId: themeId,
          selectedComponentId: null,
          activePageId: null,
        }),

        setActivePage: (pageId) => set({
          activePageId: pageId,
          selectedComponentId: null,
        }),

        selectComponent: (componentId) => set({
          selectedComponentId: componentId
        }),

        setViewport: (viewport) => set({ viewport }),

        setDragging: (isDragging) => set({ isDragging }),

        togglePreviewMode: () => set((state) => ({
          isPreviewMode: !state.isPreviewMode,
          selectedComponentId: null,
        })),

        setPreviewMode: (isPreview) => set({
          isPreviewMode: isPreview,
          selectedComponentId: isPreview ? null : undefined,
        }),

        setSaving: (isSaving) => set({ isSaving }),

        copyComponent: (component) => set({
          copiedComponent: component
        }),

        clearClipboard: () => set({ copiedComponent: null }),

        reset: () => set(initialState),
      }),
      {
        name: 'theme-builder-editor',
        partialize: (state) => ({
          viewport: state.viewport,
        }),
      }
    ),
    { name: 'EditorStore' }
  )
);
