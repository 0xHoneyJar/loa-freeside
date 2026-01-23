import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import { useEditorStore, useThemeStore } from '@stores';
import { ViewportSelector } from './ViewportSelector';
import { generatePreview } from '@api/themes';
import type { ViewportSize } from '@types';

const viewportWidths: Record<ViewportSize, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
};

export function PreviewPanel() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const theme = useThemeStore((s) => s.theme);
  const activePageId = useEditorStore((s) => s.activePageId);
  const viewport = useEditorStore((s) => s.viewport);
  const setViewport = useEditorStore((s) => s.setViewport);

  const { mutate: refreshPreview, isPending, error, data: previewHtml } = useMutation({
    mutationFn: async () => {
      if (!theme?.id || !activePageId) {
        throw new Error('No theme or page selected');
      }
      return generatePreview(theme.id, activePageId, viewport);
    },
  });

  // Auto-refresh on theme/page/viewport changes
  useEffect(() => {
    if (theme && activePageId) {
      // Debounce preview refresh
      const timeoutId = setTimeout(() => {
        refreshPreview();
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [theme, activePageId, viewport, refreshPreview]);

  // Calculate scale to fit preview in container
  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth - 32; // padding
        const viewportWidth = viewportWidths[viewport];
        const newScale = Math.min(1, containerWidth / viewportWidth);
        setScale(newScale);
      }
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [viewport]);

  // Update iframe content
  useEffect(() => {
    if (iframeRef.current && previewHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previewHtml);
        doc.close();
      }
    }
  }, [previewHtml]);

  const handleOpenInNewTab = () => {
    if (previewHtml) {
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(previewHtml);
        newWindow.document.close();
      }
    }
  };

  // Generate local preview when API is not available
  const localPreviewHtml = useCallback(() => {
    if (!theme) return '';

    const page = theme.pages.find((p) => p.id === activePageId) || theme.pages[0];
    if (!page) return '';

    const { branding } = theme;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${theme.name} - ${page.name}</title>
  <style>
    :root {
      --color-primary: ${branding.colors.primary};
      --color-secondary: ${branding.colors.secondary};
      --color-accent: ${branding.colors.accent};
      --color-background: ${branding.colors.background};
      --color-surface: ${branding.colors.surface};
      --color-text: ${branding.colors.text};
      --font-heading: '${branding.fonts.heading.family}', sans-serif;
      --font-body: '${branding.fonts.body.family}', sans-serif;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--font-body);
      background-color: var(--color-background);
      color: var(--color-text);
      min-height: 100vh;
      padding: ${branding.spacing === 'compact' ? '1rem' : branding.spacing === 'spacious' ? '3rem' : '2rem'};
    }

    .preview-header {
      text-align: center;
      padding: 2rem;
      background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
      color: white;
      border-radius: ${branding.borderRadius === 'none' ? '0' : branding.borderRadius === 'sm' ? '0.25rem' : branding.borderRadius === 'lg' ? '1rem' : branding.borderRadius === 'full' ? '9999px' : '0.5rem'};
      margin-bottom: 2rem;
    }

    .preview-header h1 {
      font-family: var(--font-heading);
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    .preview-components {
      display: flex;
      flex-direction: column;
      gap: ${branding.spacing === 'compact' ? '1rem' : branding.spacing === 'spacious' ? '2rem' : '1.5rem'};
    }

    .component-placeholder {
      background: var(--color-surface);
      border: 2px dashed var(--color-primary);
      border-radius: ${branding.borderRadius === 'none' ? '0' : branding.borderRadius === 'sm' ? '0.25rem' : branding.borderRadius === 'lg' ? '1rem' : '0.5rem'};
      padding: 2rem;
      text-align: center;
      color: var(--color-text);
      opacity: 0.7;
    }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--color-text);
      opacity: 0.5;
    }
  </style>
</head>
<body>
  <div class="preview-header">
    <h1>${theme.name}</h1>
    <p>${page.name}</p>
  </div>
  <div class="preview-components">
    ${page.components.length > 0
      ? page.components.map((c) => `
      <div class="component-placeholder">
        <strong>${c.type}</strong>
        <p>Component preview</p>
      </div>
    `).join('')
      : `
      <div class="empty-state">
        <p>No components on this page</p>
        <p>Drag components from the palette to get started</p>
      </div>
    `}
  </div>
</body>
</html>
    `;
  }, [theme, activePageId]);

  // Use local preview if API preview fails or is loading
  const displayHtml = previewHtml || localPreviewHtml();

  useEffect(() => {
    if (iframeRef.current && displayHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(displayHtml);
        doc.close();
      }
    }
  }, [displayHtml]);

  if (!theme) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-100">
        <p className="text-surface-500">Select a theme to preview</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-surface-100 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 bg-white border-b border-surface-200">
        <ViewportSelector value={viewport} onChange={setViewport} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-500">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => refreshPreview()}
            disabled={isPending}
            className="p-2 text-surface-500 hover:text-surface-700 hover:bg-surface-100
              rounded-lg transition-colors disabled:opacity-50"
            title="Refresh preview"
          >
            <RefreshCw size={16} className={isPending ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleOpenInNewTab}
            disabled={!displayHtml}
            className="p-2 text-surface-500 hover:text-surface-700 hover:bg-surface-100
              rounded-lg transition-colors disabled:opacity-50"
            title="Open in new tab"
          >
            <ExternalLink size={16} />
          </button>
        </div>
      </div>

      {/* Preview Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 flex items-start justify-center"
      >
        {error && (
          <div className="flex items-center gap-2 p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm mb-4">
            <AlertCircle size={16} />
            <span>Using local preview (API unavailable)</span>
          </div>
        )}

        <div
          className="bg-white shadow-lg rounded-lg overflow-hidden"
          style={{
            width: viewportWidths[viewport],
            transform: `scale(${scale})`,
            transformOrigin: 'top center',
          }}
        >
          <iframe
            ref={iframeRef}
            title="Theme Preview"
            className="w-full border-0"
            style={{
              height: '600px',
              minHeight: '600px',
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}
