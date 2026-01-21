import { useState } from 'react';
import { clsx } from 'clsx';
import { X, Clock, RotateCcw, Check } from 'lucide-react';
import { useThemeStore } from '@stores';

interface Version {
  id: string;
  version: string;
  createdAt: string;
  createdBy: string;
  isCurrent: boolean;
}

interface VersionHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRollback: (versionId: string) => Promise<void>;
}

// Mock versions for MVP
const mockVersions: Version[] = [
  {
    id: 'v3',
    version: '1.2.0',
    createdAt: '2026-01-21T10:30:00Z',
    createdBy: 'admin@example.com',
    isCurrent: true,
  },
  {
    id: 'v2',
    version: '1.1.0',
    createdAt: '2026-01-20T15:45:00Z',
    createdBy: 'admin@example.com',
    isCurrent: false,
  },
  {
    id: 'v1',
    version: '1.0.0',
    createdAt: '2026-01-19T09:00:00Z',
    createdBy: 'admin@example.com',
    isCurrent: false,
  },
];

export function VersionHistoryDialog({
  isOpen,
  onClose,
  onRollback,
}: VersionHistoryDialogProps) {
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const theme = useThemeStore((s) => s.theme);

  if (!isOpen || !theme) return null;

  const handleRollback = async () => {
    if (!selectedVersion) return;
    setIsRollingBack(true);
    try {
      await onRollback(selectedVersion);
      onClose();
    } catch (error) {
      console.error('Rollback failed:', error);
    } finally {
      setIsRollingBack(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-200">
          <div className="flex items-center gap-2">
            <Clock size={20} className="text-primary-500" />
            <h3 className="text-lg font-semibold">Version History</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-surface-400 hover:text-surface-600 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 max-h-96 overflow-y-auto">
          <div className="space-y-2">
            {mockVersions.map((version) => (
              <button
                key={version.id}
                onClick={() => !version.isCurrent && setSelectedVersion(version.id)}
                disabled={version.isCurrent}
                className={clsx(
                  'w-full p-3 rounded-lg border-2 text-left transition-all',
                  version.isCurrent
                    ? 'border-green-200 bg-green-50 cursor-default'
                    : selectedVersion === version.id
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-surface-200 hover:border-surface-300'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-sm">
                      v{version.version}
                    </span>
                    {version.isCurrent && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                        <Check size={12} />
                        Current
                      </span>
                    )}
                  </div>
                  {!version.isCurrent && selectedVersion === version.id && (
                    <Check size={16} className="text-primary-500" />
                  )}
                </div>
                <div className="mt-1 text-xs text-surface-500">
                  {formatDate(version.createdAt)} • {version.createdBy}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-200">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-surface-700
                bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRollback}
              disabled={!selectedVersion || isRollingBack}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm
                font-medium text-white bg-orange-500 hover:bg-orange-600
                disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {isRollingBack ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Rolling back...
                </>
              ) : (
                <>
                  <RotateCcw size={16} />
                  Rollback to Selected
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
