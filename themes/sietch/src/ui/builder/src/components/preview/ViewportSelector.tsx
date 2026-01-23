import { clsx } from 'clsx';
import { Monitor, Tablet, Smartphone } from 'lucide-react';
import type { ViewportSize } from '@types';

interface ViewportSelectorProps {
  value: ViewportSize;
  onChange: (value: ViewportSize) => void;
}

const viewports: Array<{ value: ViewportSize; icon: React.ElementType; label: string; width: string }> = [
  { value: 'desktop', icon: Monitor, label: 'Desktop', width: '1280px' },
  { value: 'tablet', icon: Tablet, label: 'Tablet', width: '768px' },
  { value: 'mobile', icon: Smartphone, label: 'Mobile', width: '375px' },
];

export function ViewportSelector({ value, onChange }: ViewportSelectorProps) {
  return (
    <div className="flex items-center gap-1 bg-surface-100 rounded-lg p-1">
      {viewports.map((viewport) => {
        const Icon = viewport.icon;
        const isActive = value === viewport.value;

        return (
          <button
            key={viewport.value}
            onClick={() => onChange(viewport.value)}
            className={clsx(
              'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-white text-primary-600 shadow-sm'
                : 'text-surface-600 hover:text-surface-900'
            )}
            title={`${viewport.label} (${viewport.width})`}
          >
            <Icon size={16} />
            <span className="hidden sm:inline">{viewport.label}</span>
          </button>
        );
      })}
    </div>
  );
}
