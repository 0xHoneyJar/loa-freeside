import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Save,
  Loader2,
  Eye,
  EyeOff,
  Rocket,
  Clock,
  Undo2,
  Redo2,
  Palette,
  Check,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useEditorStore, useThemeStore } from '@stores';
import { updateTheme } from '@api/themes';
import { PublishDialog } from './PublishDialog';
import { VersionHistoryDialog } from './VersionHistoryDialog';

interface EditorToolbarProps {
  onOpenBranding: () => void;
  showBranding: boolean;
}

export function EditorToolbar({ onOpenBranding, showBranding }: EditorToolbarProps) {
  const [showPublish, setShowPublish] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSaveIndicator, setShowSaveIndicator] = useState(false);

  const theme = useThemeStore((s) => s.theme);
  const isDirty = useThemeStore((s) => s.isDirty);
  const markClean = useThemeStore((s) => s.markClean);
  const isPreviewMode = useEditorStore((s) => s.isPreviewMode);
  const togglePreviewMode = useEditorStore((s) => s.togglePreviewMode);
  const setSaving = useEditorStore((s) => s.setSaving);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);

  // Save mutation
  const { mutate: saveTheme, isPending: isSavingApi } = useMutation({
    mutationFn: async () => {
      if (!theme) throw new Error('No theme to save');
      return updateTheme(theme.id, theme);
    },
    onSuccess: () => {
      markClean();
      setShowSaveIndicator(true);
      setTimeout(() => setShowSaveIndicator(false), 2000);
    },
    onError: (error) => {
      console.error('Save failed:', error);
    },
  });

  // Handle save
  const handleSave = useCallback(() => {
    if (!isDirty || isSavingApi) return;
    setSaving(true);
    saveTheme();
    setSaving(false);
  }, [isDirty, isSavingApi, saveTheme, setSaving]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        togglePreviewMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, togglePreviewMode]);

  // Auto-save debounce
  useEffect(() => {
    if (!isDirty) return;

    const timeoutId = setTimeout(() => {
      // Auto-save after 30 seconds of inactivity
      // Disabled for MVP - requires explicit save
      // handleSave();
    }, 30000);

    return () => clearTimeout(timeoutId);
  }, [isDirty]);

  const handlePublish = async () => {
    // Mock publish - would call API in production
    await new Promise((resolve) => setTimeout(resolve, 1500));
  };

  const handleRollback = async (versionId: string) => {
    // Mock rollback - would call API in production
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('Rolling back to version:', versionId);
  };

  return (
    <>
      <header className="h-14 bg-white border-b border-surface-200 flex items-center px-4 gap-4">
        {/* Logo / Title */}
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-primary-600">Theme Builder</h1>
          {theme && (
            <span className="text-sm text-surface-500">
              {theme.name}
              {isDirty && <span className="text-orange-500 ml-1">•</span>}
            </span>
          )}
        </div>

        {/* Save Indicator */}
        {showSaveIndicator && (
          <div className="flex items-center gap-1.5 text-green-600 text-sm animate-fade-in">
            <Check size={14} />
            Saved
          </div>
        )}

        <div className="flex-1" />

        {/* Undo/Redo */}
        <div className="flex items-center gap-1 border-r border-surface-200 pr-3 mr-1">
          <button
            onClick={() => {}}
            disabled={!canUndo}
            className="p-2 text-surface-400 hover:text-surface-600 disabled:opacity-30
              rounded-lg transition-colors"
            title="Undo (Cmd+Z)"
          >
            <Undo2 size={18} />
          </button>
          <button
            onClick={() => {}}
            disabled={!canRedo}
            className="p-2 text-surface-400 hover:text-surface-600 disabled:opacity-30
              rounded-lg transition-colors"
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo2 size={18} />
          </button>
        </div>

        {/* Branding Toggle */}
        <button
          onClick={onOpenBranding}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            showBranding
              ? 'bg-primary-100 text-primary-700'
              : 'text-surface-600 hover:bg-surface-100'
          )}
        >
          <Palette size={16} />
          Branding
        </button>

        {/* Preview Toggle */}
        <button
          onClick={togglePreviewMode}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            isPreviewMode
              ? 'bg-primary-100 text-primary-700'
              : 'text-surface-600 hover:bg-surface-100'
          )}
          title="Toggle Preview (Cmd+P)"
        >
          {isPreviewMode ? <EyeOff size={16} /> : <Eye size={16} />}
          {isPreviewMode ? 'Exit Preview' : 'Preview'}
        </button>

        {/* History */}
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-2 px-3 py-2 text-surface-600
            hover:bg-surface-100 rounded-lg text-sm font-medium transition-colors"
        >
          <Clock size={16} />
          History
        </button>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={!isDirty || isSavingApi}
          className="flex items-center gap-2 px-4 py-2 text-surface-700
            bg-surface-100 hover:bg-surface-200
            disabled:opacity-50 disabled:cursor-not-allowed
            rounded-lg text-sm font-medium transition-colors"
          title="Save (Cmd+S)"
        >
          {isSavingApi ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save
        </button>

        {/* Publish */}
        <button
          onClick={() => setShowPublish(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white
            hover:bg-primary-600 rounded-lg text-sm font-medium transition-colors"
        >
          <Rocket size={16} />
          Publish
        </button>
      </header>

      {/* Dialogs */}
      <PublishDialog
        isOpen={showPublish}
        onClose={() => setShowPublish(false)}
        onPublish={handlePublish}
      />

      <VersionHistoryDialog
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        onRollback={handleRollback}
      />
    </>
  );
}
