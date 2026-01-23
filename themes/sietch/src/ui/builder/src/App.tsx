/**
 * Theme Builder Application
 *
 * SECURITY: CRIT-3 Frontend Authentication Remediation
 * Includes authentication gate before rendering editor.
 *
 * @see grimoires/loa/a2a/audits/2026-01-21/SECURITY-AUDIT-REPORT.md
 */

import { useEffect, useState } from 'react';
import { useEditorStore, useThemeStore } from '@stores';
import { ComponentPalette } from '@components/palette';
import { Canvas } from '@components/canvas';
import { PropertiesPanel } from '@components/properties';
import { BrandingEditor } from '@components/branding';
import { PreviewPanel } from '@components/preview';
import { EditorToolbar } from '@components/toolbar';
import { LoginPage } from '@components/auth';
import { useAuth } from '../hooks/useAuth.js';
import { Loader2 } from 'lucide-react';

/**
 * Loading screen while verifying authentication
 */
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-4" />
        <p className="text-slate-400">Verifying authentication...</p>
      </div>
    </div>
  );
}

/**
 * Main editor component (only rendered when authenticated)
 */
function ThemeEditor() {
  const [showBranding, setShowBranding] = useState(false);

  const setTheme = useThemeStore((s) => s.setTheme);
  const setActivePage = useEditorStore((s) => s.setActivePage);
  const isPreviewMode = useEditorStore((s) => s.isPreviewMode);

  // Load mock theme for development
  useEffect(() => {
    // In production, this would fetch from API
    const mockTheme = {
      id: 'theme_1',
      name: 'My Community Theme',
      description: 'A custom theme for our Web3 community',
      branding: {
        colors: {
          primary: '#3b82f6',
          secondary: '#6366f1',
          accent: '#f59e0b',
          background: '#ffffff',
          surface: '#f5f5f5',
          text: '#1f2937',
        },
        fonts: {
          heading: { family: 'Inter', weight: 700 },
          body: { family: 'Inter', weight: 400 },
        },
        borderRadius: 'md' as const,
        spacing: 'comfortable' as const,
      },
      pages: [
        {
          id: 'page_home',
          name: 'Home',
          slug: 'home',
          components: [],
        },
        {
          id: 'page_members',
          name: 'Members',
          slug: 'members',
          components: [],
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setTheme(mockTheme);
    setActivePage('page_home');
  }, [setTheme, setActivePage]);

  // Determine which right panel to show
  const getRightPanel = () => {
    if (isPreviewMode) {
      return null; // No right panel in preview mode
    }

    if (showBranding) {
      return (
        <aside className="w-80 bg-white border-l border-surface-200 flex flex-col">
          <div className="p-4 border-b border-surface-200">
            <h2 className="text-lg font-semibold">Theme Branding</h2>
            <p className="text-xs text-surface-500 mt-1">
              Customize colors, fonts, and layout
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <BrandingEditor />
          </div>
        </aside>
      );
    }

    return <PropertiesPanel />;
  };

  return (
    <div className="h-screen flex flex-col bg-surface-50">
      <EditorToolbar
        onOpenBranding={() => setShowBranding(!showBranding)}
        showBranding={showBranding}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Component Palette */}
        {!isPreviewMode && <ComponentPalette />}

        {/* Main Area: Canvas or Preview */}
        {isPreviewMode ? (
          <PreviewPanel />
        ) : (
          <Canvas />
        )}

        {/* Right Panel: Properties or Branding */}
        {getRightPanel()}
      </div>
    </div>
  );
}

/**
 * App Component with Authentication Gate
 * SECURITY: Requires authentication before showing editor
 */
function App() {
  const { isAuthenticated, isLoading, error, login } = useAuth();

  // Show loading screen while checking auth
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return (
      <LoginPage
        onLogin={login}
        error={error}
        isLoading={isLoading}
      />
    );
  }

  // Show editor when authenticated
  return <ThemeEditor />;
}

export default App;
