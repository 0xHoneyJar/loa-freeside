import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import {
  Wallet,
  Image,
  Trophy,
  User,
  Type,
  LayoutGrid,
  Box,
} from 'lucide-react';
import type { ComponentDefinition } from '@types';

interface ComponentCardProps {
  definition: ComponentDefinition;
}

const iconMap: Record<string, React.ElementType> = {
  wallet: Wallet,
  image: Image,
  trophy: Trophy,
  user: User,
  type: Type,
  'layout-grid': LayoutGrid,
  grid: LayoutGrid,
  box: Box,
};

function getIcon(iconName: string): React.ElementType {
  return iconMap[iconName.toLowerCase()] || Box;
}

const categoryColors: Record<string, string> = {
  web3: 'bg-purple-100 text-purple-700 border-purple-200',
  content: 'bg-blue-100 text-blue-700 border-blue-200',
  layout: 'bg-green-100 text-green-700 border-green-200',
  social: 'bg-orange-100 text-orange-700 border-orange-200',
};

export function ComponentCard({ definition }: ComponentCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${definition.type}`,
    data: {
      type: 'new-component',
      componentType: definition.type,
      definition,
    },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const Icon = getIcon(definition.icon);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={clsx(
        'p-3 bg-white rounded-lg border border-surface-200 cursor-grab',
        'hover:border-primary-300 hover:shadow-sm transition-all',
        'select-none',
        isDragging && 'opacity-50 cursor-grabbing shadow-lg z-50'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={clsx(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          categoryColors[definition.category] || 'bg-surface-100 text-surface-600'
        )}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-900 truncate">
            {definition.name}
          </h3>
          <p className="text-xs text-gray-500 truncate">
            {definition.description}
          </p>
        </div>
      </div>
    </div>
  );
}
