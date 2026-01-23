import { useState } from 'react';
import { X, Rocket, AlertTriangle, Check } from 'lucide-react';
import { useThemeStore } from '@stores';

interface PublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPublish: () => Promise<void>;
}

export function PublishDialog({ isOpen, onClose, onPublish }: PublishDialogProps) {
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<string | null>(null);
  const theme = useThemeStore((s) => s.theme);

  if (!isOpen || !theme) return null;

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      await onPublish();
      setPublishedVersion('1.0.0'); // Mock version
    } catch (error) {
      console.error('Publish failed:', error);
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-200">
          <h3 className="text-lg font-semibold">Publish Theme</h3>
          <button
            onClick={onClose}
            className="p-1 text-surface-400 hover:text-surface-600 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {publishedVersion ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-green-500" />
              </div>
              <h4 className="text-lg font-semibold text-gray-900 mb-2">
                Published Successfully!
              </h4>
              <p className="text-sm text-surface-500 mb-4">
                Your theme is now live at version {publishedVersion}
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-primary-500 text-white rounded-lg
                  hover:bg-primary-600 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3 p-3 bg-yellow-50 rounded-lg mb-4">
                <AlertTriangle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">
                    Publishing will make this theme live
                  </p>
                  <p className="text-xs text-yellow-600 mt-1">
                    Your community members will see these changes immediately.
                  </p>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Theme name</span>
                  <span className="font-medium">{theme.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Pages</span>
                  <span className="font-medium">{theme.pages.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Components</span>
                  <span className="font-medium">
                    {theme.pages.reduce((sum, p) => sum + p.components.length, 0)}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm font-medium text-surface-700
                    bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePublish}
                  disabled={isPublishing}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm
                    font-medium text-white bg-primary-500 hover:bg-primary-600
                    disabled:opacity-50 rounded-lg transition-colors"
                >
                  {isPublishing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Rocket size={16} />
                      Publish Now
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
